// Edge Function: gif-search
//
// Searches GIFs for the community composer. It runs on the server so the provider's API key never ships inside the
// extension, and so only signed-in people can spend it. Needs the secret GIPHY_API_KEY (free at developers.giphy.com):
//   supabase secrets set GIPHY_API_KEY=...
// Without it the function answers { ok: false, error: 'not_configured' } and the app says GIF search isn't set up.
//
// Request:  POST { q?: string, next?: string }     ("" or missing q means trending; `next` is the cursor from the last page)
// Response: { ok: true, gifs: [{ id, title, url, preview, width, height }], next: string | null } | { ok: false, error }
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { cleanQuery, giphyUrl, PAGE_SIZE, parseGiphy, parseOffset } from './lib.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const auth = createClient(Deno.env.get('SUPABASE_URL') as string, Deno.env.get('SUPABASE_ANON_KEY') as string, { auth: { persistSession: false } });

// A polite per-person limit (per function instance — enough to stop a runaway loop, not a hard quota).
const hits = new Map<string, number[]>();
function limited(user: string): boolean {
  const now = Date.now();
  const recent = (hits.get(user) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(user, recent);
  return recent.length > 40;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data } = await auth.auth.getUser(token);
  if (!data.user) return json({ error: 'unauthorized' }, 401);
  if (limited(data.user.id)) return json({ ok: false, error: 'rate_limited' });

  const key = Deno.env.get('GIPHY_API_KEY');
  if (!key) return json({ ok: false, error: 'not_configured' });

  const body = (await req.json().catch(() => ({}))) as { q?: unknown; next?: unknown };
  const offset = parseOffset(body.next);
  try {
    const res = await fetch(giphyUrl(key, cleanQuery(body.q), offset), { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return json({ ok: false, error: 'upstream' });
    const page = parseGiphy(await res.json(), offset);
    return json({ ok: true, ...page, pageSize: PAGE_SIZE });
  } catch {
    return json({ ok: false, error: 'upstream' });
  }
});
