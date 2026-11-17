// Pure helpers for the gif-search Edge Function (no Deno APIs, so they can be unit-tested with Vitest).

export type Gif = { id: string; title: string; url: string; preview: string; width: number; height: number };
export type GifPage = { gifs: Gif[]; next: string | null };

const GIF_HOST = /^(?:media\d*|i)\.giphy\.com$/i;
export const PAGE_SIZE = 24;
/** The provider refuses offsets beyond this. */
const MAX_OFFSET = 4900;

/** A search term safe to forward: no control characters, collapsed whitespace, capped length. */
export function cleanQuery(q: unknown): string {
  if (typeof q !== 'string') return '';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  return q.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** `next` cursors are plain offsets; anything else means "from the start". */
export function parseOffset(next: unknown): number {
  const n = typeof next === 'string' && /^\d{1,4}$/.test(next) ? Number(next) : 0;
  return Math.min(n, MAX_OFFSET);
}

export function giphyUrl(key: string, query: string, offset: number): string {
  const u = new URL(`https://api.giphy.com/v1/gifs/${query ? 'search' : 'trending'}`);
  u.searchParams.set('api_key', key);
  if (query) u.searchParams.set('q', query);
  u.searchParams.set('limit', String(PAGE_SIZE));
  u.searchParams.set('offset', String(offset));
  u.searchParams.set('rating', 'pg-13'); // a community of friends, not an anything-goes feed
  u.searchParams.set('lang', 'en');
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

type Rendition = { url?: unknown; width?: unknown; height?: unknown } | undefined;
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** Trim a GIPHY response down to what the picker needs; drop anything that doesn't look right. */
export function parseGiphy(json: unknown, offset: number): GifPage {
  const root = (json ?? {}) as { data?: unknown; pagination?: { total_count?: unknown; count?: unknown } };
  const items = Array.isArray(root.data) ? root.data : [];
  const gifs: Gif[] = [];
  for (const raw of items) {
    const item = (raw ?? {}) as { id?: unknown; title?: unknown; images?: Record<string, Rendition> };
    const images = item.images ?? {};
    const post = [images.downsized, images.original].find((r) => isGifUrl(r?.url)); // downsized keeps chat light (≤ 2 MB)
    const small = [images.fixed_width, images.fixed_width_small, images.downsized].find((r) => isGifUrl(r?.url));
    if (typeof item.id !== 'string' || !/^[\w-]{1,40}$/.test(item.id) || !post || !small) continue;
    gifs.push({
      id: item.id,
      title: typeof item.title === 'string' ? item.title.trim().slice(0, 100) : '',
      url: post.url as string,
      preview: small.url as string,
      width: num(small.width) || 200,
      height: num(small.height) || 150,
    });
  }
  const total = num(root.pagination?.total_count);
  const count = num(root.pagination?.count) || items.length;
  const nextOffset = offset + count;
  return { gifs, next: count > 0 && nextOffset < total && nextOffset <= MAX_OFFSET ? String(nextOffset) : null };
}
