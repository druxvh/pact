// Edge Function: feeds
//
// Fetches RSS 2.0 / Atom / RSS 1.0 feeds *on the server* for pact's Discover page and returns them as one plain JSON
// shape. Browsers can't read arbitrary feeds cross-origin without broad host permissions (which the extension doesn't
// ask for), and doing it here also keeps the reader's IP address from every publisher.
//
// Request:  POST { urls: string[] (≤ 12, https), limit?: number (1–50, default 20) }
// Response: { ok: true, feeds: [{ url, title, items: Item[] }], failed: [{ url, reason }] } | { error } | { ok: false, error: 'rate_limited' }
//           (Item is defined in ./lib.ts: id, title, url, summary, contentHtml, image, author, publishedAt, categories, words)
//
// Safety: the caller must be a signed-in user (the anon key alone is not enough) with a per-user rate limit. Only public
// https hosts are fetched — private/loopback/link-local addresses are refused, DNS answers are checked and every redirect
// (max 3) is re-checked (see lib.ts). Answers must be XML-ish, are read up to 1.5 MB, time out after 6 s, and are cached in
// memory for 10 minutes per URL. No secrets are involved and nothing is stored.
//
// Known limit: DNS is resolved once to check it and again by fetch(); a hostile DNS server could answer differently the
// second time (rebinding). Supabase Edge Functions run in an isolated network, which is the backstop.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  addressesArePublic,
  applyContentBudget,
  checkUrl,
  cleanLimit,
  cleanUrls,
  detectCharset,
  isFeedContentType,
  type Item,
  MAX_BODY_BYTES,
  parseFeed,
} from './lib.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const CACHE_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 150;
const CONCURRENCY = 5;
const KEPT_IN_CACHE = 50;

const auth = createClient(Deno.env.get('SUPABASE_URL') as string, Deno.env.get('SUPABASE_ANON_KEY') as string, { auth: { persistSession: false } });

// A polite per-person limit (per function instance — enough to stop a runaway loop, not a hard quota).
const hits = new Map<string, number[]>();
function limited(user: string): boolean {
  const now = Date.now();
  const recent = (hits.get(user) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(user, recent);
  if (hits.size > 2000) for (const [k, v] of hits) if (!v.some((t) => now - t < 60_000)) hits.delete(k);
  return recent.length > 30;
}

type Cached = { at: number; title: string; items: Item[] } | { at: number; error: string };
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<Cached>>();

function remember(url: string, value: Cached) {
  cache.delete(url);
  cache.set(url, value);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Where does this name point? Literal IPs were already checked by checkUrl; for names, one private answer is enough to refuse. */
async function resolveHost(host: string): Promise<'public' | 'private' | 'unresolved'> {
  if (/^[\d.]+$/.test(host) || host.includes(':')) return 'public';
  try {
    const [a, aaaa] = await Promise.all([Deno.resolveDns(host, 'A').catch(() => [] as string[]), Deno.resolveDns(host, 'AAAA').catch(() => [] as string[])]);
    const all = [...a, ...aaaa];
    if (all.length === 0) return 'unresolved';
    return addressesArePublic(all) ? 'public' : 'private';
  } catch {
    return 'unresolved';
  }
}

type Fetched = { ok: true; res: Response } | { ok: false; reason: string };

/** fetch() that re-validates the target at every hop and gives up quickly. */
async function safeFetch(start: string): Promise<Fetched> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = checkUrl(url);
    if (!check.ok) return { ok: false, reason: 'blocked' };
    const where = await resolveHost(check.url.hostname);
    if (where === 'private') return { ok: false, reason: 'blocked' };
    if (where === 'unresolved') return { ok: false, reason: 'unreachable' };
    let res: Response;
    try {
      res = await fetch(check.url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          Accept: 'application/rss+xml, application/atom+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.8',
          'User-Agent': 'Mozilla/5.0 (compatible; pact-feeds/1.0)',
          'Accept-Language': 'en',
        },
      });
    } catch {
      return { ok: false, reason: 'unreachable' };
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      await res.body?.cancel();
      if (!loc) return { ok: false, reason: 'unreachable' };
      try {
        url = new URL(loc, check.url).toString();
      } catch {
        return { ok: false, reason: 'unreachable' };
      }
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      return { ok: false, reason: res.status === 404 || res.status === 410 ? 'not_found' : res.status === 403 || res.status === 401 || res.status === 429 ? 'refused' : 'unreachable' };
    }
    return { ok: true, res };
  }
  return { ok: false, reason: 'too_many_redirects' };
}

/** Read up to `limit` bytes. A longer feed is cut there (the parser only uses complete items). */
async function readLimited(res: Response, limit: number): Promise<Uint8Array | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > limit) {
      chunks.push(value.subarray(0, limit - total));
      total = limit;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

async function load(url: string): Promise<Cached> {
  const got = await safeFetch(url);
  if (!got.ok) return { at: Date.now(), error: got.reason };
  const { res } = got;
  if (!isFeedContentType(res.headers.get('content-type'))) {
    await res.body?.cancel();
    return { at: Date.now(), error: 'not_a_feed' };
  }
  const bytes = await readLimited(res, MAX_BODY_BYTES);
  if (!bytes || bytes.length === 0) return { at: Date.now(), error: 'empty' };
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 300));
  let text: string;
  try {
    text = new TextDecoder(detectCharset(res.headers.get('content-type'), head), { fatal: false }).decode(bytes);
  } catch {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  const feed = parseFeed(text, res.url || url);
  if (!feed) return { at: Date.now(), error: 'not_a_feed' };
  if (!feed.items.length) return { at: Date.now(), error: 'empty' };
  return { at: Date.now(), title: feed.title, items: feed.items.slice(0, KEPT_IN_CACHE) };
}

function get(url: string): Promise<Cached> {
  const hit = cache.get(url);
  // Failures are remembered briefly so a dead feed in someone's list doesn't cost a 6 s timeout on every refresh.
  if (hit && Date.now() - hit.at < ('error' in hit ? 60_000 : CACHE_MS)) return Promise.resolve(hit);
  const running = inflight.get(url);
  if (running) return running;
  const p = load(url)
    .then((value) => {
      remember(url, value);
      return value;
    })
    .finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

/** Run `fn` over `items` with at most `n` in flight. */
async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data } = await auth.auth.getUser(token);
  if (!data.user) return json({ error: 'unauthorized' }, 401);
  if (limited(data.user.id)) return json({ ok: false, error: 'rate_limited' });

  const body = (await req.json().catch(() => null)) as { urls?: unknown; limit?: unknown } | null;
  if (!body || !Array.isArray(body.urls)) return json({ error: 'bad_request' }, 400);
  const { urls, rejected } = cleanUrls(body.urls);
  if (!urls.length && !rejected.length) return json({ error: 'bad_request' }, 400);
  const limit = cleanLimit(body.limit);

  const results = await pool(urls, CONCURRENCY, async (url) => ({ url, value: await get(url) }));
  const feeds: Array<{ url: string; title: string; items: Item[] }> = [];
  const failed: Array<{ url: string; reason: string }> = [...rejected];
  for (const { url, value } of results) {
    if ('error' in value) failed.push({ url, reason: value.error });
    else feeds.push({ url, title: value.title, items: applyContentBudget(value.items.slice(0, limit)) });
  }
  return json({ ok: true, feeds, failed });
});
