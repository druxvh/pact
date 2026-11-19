import { describe, expect, it } from 'vitest';
import { cleanQuery, isGifUrl, klipyUrl, PAGE_SIZE, parseKlipy, parsePage } from '../../../supabase/functions/gif-search/lib';
import { gifUrl } from './links';

const H = 'https://static.klipy.com/ii/abc123/84/09';
const rend = (name: string, w = 220, h = 229, size = 70_000) => ({ url: `${H}/${name}`, width: w, height: h, size });
/** The shape KLIPY really returns: file.<hd|md|sm|xs>.<gif|webp|jpg|mp4|webm> */
const item = (slug: string, over: Record<string, unknown> = {}) => ({
  id: 2484942301552561,
  slug,
  title: `Title ${slug}`,
  type: 'gif',
  file: {
    hd: { gif: rend(`${slug}-hd.gif`, 220, 229, 273_000), webp: rend(`${slug}-hd.webp`), jpg: rend(`${slug}-hd.jpg`), mp4: rend(`${slug}-hd.mp4`) },
    md: { gif: rend(`${slug}-md.gif`, 220, 229, 271_000), webp: rend(`${slug}-md.webp`, 220, 229, 137_000) },
    sm: { gif: rend(`${slug}-sm.gif`, 200, 208, 100_000), webp: rend(`${slug}-sm.webp`, 200, 208, 50_000) },
    xs: { gif: rend(`${slug}-xs.gif`, 87, 90, 99_000), webp: rend(`${slug}-xs.webp`, 87, 90, 29_000) },
  },
  ...over,
});
const page = (items: unknown[], has_next = true) => ({ result: true, data: { data: items, current_page: 1, per_page: 24, has_next } });

describe('gif-search: request building', () => {
  it('cleans the query: control characters, whitespace, length, wrong types', () => {
    expect(cleanQuery('  mind \n\t blown\u0000 ')).toBe('mind blown');
    expect(cleanQuery('x'.repeat(500))).toHaveLength(80);
    expect(cleanQuery(42)).toBe('');
    expect(cleanQuery(undefined)).toBe('');
  });

  it('only accepts small numeric page cursors', () => {
    expect(parsePage('2')).toBe(2);
    expect(parsePage('../../etc')).toBe(1);
    expect(parsePage('99999')).toBe(1);
    expect(parsePage(null)).toBe(1);
    expect(parsePage('0')).toBe(1);
    expect(parsePage('999')).toBe(100);
  });

  it('builds a search URL with the key in the path and a trending URL without a query', () => {
    const s = new URL(klipyUrl('KEY', 'cats & dogs', 2));
    expect(s.origin).toBe('https://api.klipy.com');
    expect(s.pathname).toBe('/api/v1/KEY/gifs/search');
    expect(s.searchParams.get('q')).toBe('cats & dogs');
    expect(s.searchParams.get('page')).toBe('2');
    expect(s.searchParams.get('per_page')).toBe(String(PAGE_SIZE));
    expect(s.searchParams.get('rating')).toBe('pg-13');
    expect(new URL(klipyUrl('KEY', '', 1)).pathname).toBe('/api/v1/KEY/gifs/trending');
    expect(new URL(klipyUrl('KEY', '', 1)).searchParams.has('q')).toBe(false);
  });

  it('cannot be steered to another path by a strange key', () => {
    const u = new URL(klipyUrl('a/../../evil?x=', 'q', 1));
    expect(u.origin).toBe('https://api.klipy.com');
    expect(u.pathname.startsWith('/api/v1/')).toBe(true);
    expect(u.pathname.endsWith('/gifs/search')).toBe(true);
    expect(u.pathname.split('/').length).toBe(6); // /api/v1/<one segment>/gifs/search
  });
});

describe('gif-search: response parsing', () => {
  it('maps an item: animated WebP to post, a small WebP as the preview, the slug as id', () => {
    const p = parseKlipy(page([item('cat-1')]), 1);
    expect(p.gifs).toEqual([{ id: 'cat-1', title: 'Title cat-1', url: `${H}/cat-1-hd.webp`, preview: `${H}/cat-1-sm.webp`, width: 200, height: 208 }]);
    expect(p.next).toBe('2');
  });

  it('falls back to GIF renditions when there is no WebP', () => {
    const only = item('g', { file: { hd: { gif: rend('g-hd.gif') }, sm: { gif: rend('g-sm.gif', 100, 80) } } });
    expect(parseKlipy(page([only]), 1).gifs[0]).toMatchObject({ url: `${H}/g-hd.gif`, preview: `${H}/g-sm.gif`, width: 100, height: 80 });
  });

  it('skips oversized files, so chat stays light', () => {
    const big = item('big', {
      file: {
        hd: { webp: rend('big-hd.webp', 400, 300, 9_000_000), gif: rend('big-hd.gif', 400, 300, 9_000_000) },
        md: { webp: rend('big-md.webp', 300, 200, 800_000) },
        sm: { webp: rend('big-sm.webp') },
      },
    });
    expect(parseKlipy(page([big]), 1).gifs[0]?.url).toBe(`${H}/big-md.webp`);
    const allBig = item('huge', { file: { hd: { webp: rend('h.webp', 1, 1, 9_000_000) }, sm: { webp: rend('s.webp') } } });
    expect(parseKlipy(page([allBig]), 1).gifs).toEqual([]);
  });

  it('drops sponsored items and anything off-host, http, or malformed', () => {
    const evil = (url: string) => item('x', { slug: 'x', file: { hd: { webp: { url } }, sm: { webp: { url } } } });
    const bad = [
      item('ad-1', { type: 'ad' }),
      evil('https://evil.example/a.webp'),
      evil('http://static.klipy.com/a.webp'),
      evil('https://static.klipy.com.evil.example/a.webp'),
      evil('https://user:pw@static.klipy.com/a.webp'),
      evil('https://static.klipy.com/page.html'),
      item('no-file', { file: undefined }),
      item('bad id!', { slug: 'bad id!', id: undefined }),
      null,
      'nope',
    ];
    const p = parseKlipy(page([...bad, item('ok')]), 1);
    expect(p.gifs.map((g) => g.id)).toEqual(['ok']);
  });

  it('falls back to the numeric id when there is no slug, and keeps unknown-type items out only when typed otherwise', () => {
    const noSlug = item('s', { slug: undefined, id: 123456 });
    expect(parseKlipy(page([noSlug]), 1).gifs[0]?.id).toBe('123456');
    const untyped = item('u', { type: undefined });
    expect(parseKlipy(page([untyped]), 1).gifs).toHaveLength(1);
  });

  it('only offers a next page while the API says there is one', () => {
    expect(parseKlipy(page([item('a')], true), 3).next).toBe('4');
    expect(parseKlipy(page([item('a')], false), 3).next).toBeNull();
    expect(parseKlipy(page([], true), 1)).toEqual({ gifs: [], next: null });
    expect(parseKlipy(page([item('a')], true), 100).next).toBeNull();
    expect(parseKlipy(null, 1)).toEqual({ gifs: [], next: null });
    expect(parseKlipy({ result: false, errors: { message: ['The provided API key is invalid.'] } }, 1)).toEqual({ gifs: [], next: null });
  });
});

describe('gif URLs', () => {
  it('only the provider’s own https GIF/WebP hosts pass', () => {
    expect(isGifUrl('https://static.klipy.com/ii/x/84/09/a.gif')).toBe(true);
    expect(isGifUrl('https://static.klipy.com/ii/x/84/09/a.webp')).toBe(true);
    expect(isGifUrl('https://klipy.com/gifs/x')).toBe(false);
    expect(isGifUrl('https://static.klipy.com.evil.example/x.gif')).toBe(false);
    expect(isGifUrl('https://media.giphy.com/media/x/giphy.gif')).toBe(false); // the server no longer hands those out
  });

  it('the app renders both KLIPY links and any GIPHY GIF posted earlier as a picture', () => {
    expect(gifUrl('https://static.klipy.com/ii/x/84/09/a.webp')).not.toBeNull();
    expect(gifUrl('https://media.giphy.com/media/abc/giphy.gif')).not.toBeNull();
    expect(gifUrl('https://static.klipy.com/ii/x/a.webp and more text')).toBeNull();
    expect(gifUrl('https://static.klipy.com.evil.example/a.gif')).toBeNull();
  });
});
