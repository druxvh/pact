// Edge Function: link-preview
//
// Given a URL a member pasted into a message, fetch it *on the server* and return its title / description / image, so
// the app can show a preview card without every viewer's browser contacting the linked site (which would leak their IP
// to it). The thumbnail is copied into our own public `link-previews` bucket for the same reason.
//
// Safety: the caller must be a signed-in user; only public http(s) hosts are fetched (see lib.ts — private/loopback/
// link-local addresses are refused, DNS answers are checked, every redirect is re-checked); responses are size- and
// time-limited; results are cached in `link_previews`.
//
// Known limit: DNS is resolved once to check it and again by fetch(); a hostile DNS server could answer differently the
// second time (rebinding). Supabase Edge Functions run in an isolated network, which is the backstop.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { addressesArePublic, checkUrl, normalizeUrl, parsePage } from './lib.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const HTML_LIMIT = 600_000;
const IMAGE_LIMIT = 1_500_000;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const CACHE_DAYS = 7;
const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

const admin = createClient(Deno.env.get('SUPABASE_URL') as string, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') as string, { auth: { persistSession: false } });

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function resolvesPublic(host: string): Promise<boolean> {
  if (/^[\d.]+$/.test(host) || host.includes(':')) return true; // literal IPs were already checked by checkUrl
  try {
    const [a, aaaa] = await Promise.all([Deno.resolveDns(host, 'A').catch(() => [] as string[]), Deno.resolveDns(host, 'AAAA').catch(() => [] as string[])]);
    return addressesArePublic([...a, ...aaaa]);
  } catch {
    return false;
  }
}

/** fetch() that re-validates the target at every hop and gives up quickly. */
async function safeFetch(start: string, accept: string): Promise<Response | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = checkUrl(url);
    if (!check.ok || !(await resolvesPublic(check.url.hostname))) return null;
    const res = await fetch(check.url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: accept, 'User-Agent': 'Mozilla/5.0 (compatible; pact-link-preview/1.0)', 'Accept-Language': 'en' },
    }).catch(() => null);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      await res.body?.cancel();
      if (!loc) return null;
      url = new URL(loc, check.url).toString();
      continue;
    }
    return res.ok ? res : null;
  }
  return null;
}

async function readLimited(res: Response, limit: number): Promise<Uint8Array | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      return limit === HTML_LIMIT ? concat(chunks, total - value.length) : null; // HTML: keep what we have (the <head> is early)
    }
    chunks.push(value);
  }
  return concat(chunks, total);
}
function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c.subarray(0, Math.min(c.length, total - off)), off);
    off += c.length;
    if (off >= total) break;
  }
  return out;
}

async function storeImage(imageUrl: string, key: string): Promise<string | null> {
  const res = await safeFetch(imageUrl, 'image/*');
  if (!res) return null;
  const type = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  const ext = IMAGE_TYPES[type];
  if (!ext) {
    await res.body?.cancel();
    return null;
  }
  const bytes = await readLimited(res, IMAGE_LIMIT);
  if (!bytes) return null;
  const path = `${key}.${ext}`;
  const { error } = await admin.storage.from('link-previews').upload(path, bytes, { contentType: type, upsert: true });
  return error ? null : path;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Only real signed-in users (the anon key alone is not enough).
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await admin.auth.getUser(token);
  if (!auth.user) return json({ error: 'unauthorized' }, 401);

  let target: string;
  try {
    const body = (await req.json()) as { url?: unknown };
    if (typeof body.url !== 'string' || body.url.length > 2000) return json({ error: 'bad_request' }, 400);
    const check = checkUrl(body.url);
    if (!check.ok) return json({ ok: false, reason: check.reason });
    target = normalizeUrl(check.url.toString());
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const key = await sha256(target);
  const publicBase = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/link-previews/`;
  const shape = (r: { title: string | null; description: string | null; site: string | null; image_path: string | null }) => ({
    ok: true,
    url: target,
    title: r.title,
    description: r.description,
    site: r.site,
    image: r.image_path ? `${publicBase}${r.image_path}` : null,
  });

  const { data: cached } = await admin.from('link_previews').select('title, description, site, image_path, fetched_at').eq('url_hash', key).maybeSingle();
  if (cached && Date.now() - Date.parse(cached.fetched_at) < CACHE_DAYS * 86_400_000) return json(shape(cached));

  const res = await safeFetch(target, 'text/html,application/xhtml+xml');
  if (!res) return json({ ok: false, reason: 'unreachable' });
  const type = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

  let info: { title: string | null; description: string | null; site: string | null; image: string | null };
  if (type.startsWith('text/html') || type === 'application/xhtml+xml') {
    const bytes = await readLimited(res, HTML_LIMIT);
    if (!bytes) return json({ ok: false, reason: 'unreadable' });
    info = parsePage(new TextDecoder('utf-8', { fatal: false }).decode(bytes), res.url || target);
  } else if (IMAGE_TYPES[type]) {
    await res.body?.cancel();
    info = { title: null, description: null, site: new URL(target).hostname.replace(/^www\./, ''), image: target }; // a direct link to a picture
  } else {
    await res.body?.cancel();
    return json({ ok: false, reason: 'not_a_page' });
  }

  const image_path = info.image ? await storeImage(info.image, key) : null;
  if (!info.title && !info.description && !image_path) return json({ ok: false, reason: 'nothing_to_show' });

  const row = { url_hash: key, url: target, title: info.title, description: info.description, site: info.site, image_path, fetched_at: new Date().toISOString() };
  await admin.from('link_previews').upsert(row, { onConflict: 'url_hash' });
  return json(shape(row));
});
