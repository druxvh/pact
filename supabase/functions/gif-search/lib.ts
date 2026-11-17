// Pure helpers for the gif-search Edge Function (no Deno APIs, so they can be unit-tested with Vitest).
// The provider is KLIPY (https://klipy.com): GET https://api.klipy.com/api/v1/<API_KEY>/gifs/{search|trending}.

export type Gif = { id: string; title: string; url: string; preview: string; width: number; height: number };
export type GifPage = { gifs: Gif[]; next: string | null };

/** The provider's own image hosts (static.klipy.com today). */
const GIF_HOST = /^(?:[a-z0-9-]+\.)*klipy\.com$/i;
export const PAGE_SIZE = 24; // the API accepts 8–50
/** Pages are 1-based; the cursor we hand out is the next page number. */
const MAX_PAGE = 100;
/** A picture bigger than this isn't offered for posting — chat should stay light. */
const MAX_BYTES = 3_000_000;

/** A search term safe to forward: no control characters, collapsed whitespace, capped length. */
export function cleanQuery(q: unknown): string {
  if (typeof q !== 'string') return '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  return q.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** `next` cursors are plain page numbers; anything else means "the first page". */
export function parsePage(next: unknown): number {
  const n = typeof next === 'string' && /^\d{1,3}$/.test(next) ? Number(next) : 1;
  return Math.min(Math.max(n, 1), MAX_PAGE);
}

/** The key travels in the URL path (that's how the API takes it): never log this URL. */
export function klipyUrl(key: string, query: string, page: number): string {
  const u = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/${query ? 'search' : 'trending'}`);
  if (query) u.searchParams.set('q', query);
  u.searchParams.set('page', String(page));
  u.searchParams.set('per_page', String(PAGE_SIZE));
  u.searchParams.set('rating', 'pg-13'); // a community of friends, not an anything-goes feed
  return u.toString();
}

/** Only https links to the provider's own GIF/WebP hosts are ever handed to the app (which renders them as images). */
export function isGifUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 600) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && GIF_HOST.test(u.hostname) && /\.(gif|webp)$/i.test(u.pathname);
  } catch {
    return false;
  }
}

type Rendition = { url?: unknown; width?: unknown; height?: unknown; size?: unknown } | undefined;
type Sizes = Record<string, Record<string, Rendition> | undefined>;
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** The first usable rendition, looking in `order` as "<size>.<format>" (e.g. "hd.webp"). Oversized files are skipped. */
function pick(file: Sizes, order: string[]): Rendition {
  for (const path of order) {
    const [size, format] = path.split('.') as [string, string];
    const r = file[size]?.[format];
    if (isGifUrl(r?.url) && !(num(r?.size) > MAX_BYTES)) return r;
  }
  return undefined;
}

/** Trim a KLIPY response down to what the picker needs; drop ads and anything that doesn't look right. */
export function parseKlipy(json: unknown, page: number): GifPage {
  const root = (json ?? {}) as { data?: { data?: unknown; has_next?: unknown } };
  const items = Array.isArray(root.data?.data) ? (root.data?.data as unknown[]) : [];
  const gifs: Gif[] = [];
  for (const raw of items) {
    const item = (raw ?? {}) as { id?: unknown; slug?: unknown; title?: unknown; type?: unknown; file?: unknown };
    if (item.type !== undefined && item.type !== 'gif') continue; // sponsored items arrive in the same list; we don't show them
    // ids exceed 2^53 sometimes, so prefer the slug (a string) as the key
    const id = typeof item.slug === 'string' && /^[\w-]{1,100}$/.test(item.slug) ? item.slug : typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id) : '';
    if (!/^[\w-]{1,100}$/.test(id) || typeof item.file !== 'object' || item.file === null) continue;
    const file = item.file as Sizes;
    // Animated WebP is a fraction of the GIF's size and Chrome plays it; GIF is the fallback.
    const post = pick(file, ['hd.webp', 'md.webp', 'hd.gif', 'md.gif']);
    const small = pick(file, ['sm.webp', 'md.webp', 'xs.webp', 'sm.gif', 'md.gif', 'xs.gif']);
    if (!post || !small) continue;
    gifs.push({
      id,
      title: typeof item.title === 'string' ? item.title.trim().slice(0, 100) : '',
      url: post.url as string,
      preview: small.url as string,
      width: num(small.width) || 200,
      height: num(small.height) || 150,
    });
  }
  return { gifs, next: items.length > 0 && root.data?.has_next === true && page < MAX_PAGE ? String(page + 1) : null };
}
