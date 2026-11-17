import { describe, expect, it } from 'vitest';
import { cleanQuery, giphyUrl, isGifUrl, PAGE_SIZE, parseGiphy, parseOffset } from '../../../supabase/functions/gif-search/lib';
import { gifUrl } from './links';

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Title ${id}`,
  images: {
    original: { url: `https://media1.giphy.com/media/${id}/giphy.gif`, width: '480', height: '270' },
    downsized: { url: `https://media1.giphy.com/media/${id}/giphy-downsized.gif`, width: '300', height: '169' },
    fixed_width: { url: `https://media1.giphy.com/media/${id}/200w.gif`, width: '200', height: '113' },
  },
  ...over,
});

describe('gif-search: request building', () => {
  it('cleans the query: control characters, whitespace, length, wrong types', () => {
    expect(cleanQuery('  mind \n\t blown\u0000 ')).toBe('mind blown');
    expect(cleanQuery('x'.repeat(500))).toHaveLength(80);
    expect(cleanQuery(42)).toBe('');
    expect(cleanQuery(undefined)).toBe('');
  });

  it('only accepts numeric cursors', () => {
    expect(parseOffset('24')).toBe(24);
    expect(parseOffset('../../etc')).toBe(0);
    expect(parseOffset('99999')).toBe(0);
    expect(parseOffset(null)).toBe(0);
    expect(parseOffset('9999')).toBe(4900);
  });

  it('builds a search URL or a trending URL, always pg-13, and encodes the query', () => {
    const s = new URL(giphyUrl('KEY', 'cats & dogs', 24));
    expect(s.pathname).toBe('/v1/gifs/search');
    expect(s.searchParams.get('q')).toBe('cats & dogs');
    expect(s.searchParams.get('offset')).toBe('24');
    expect(s.searchParams.get('rating')).toBe('pg-13');
    expect(s.searchParams.get('limit')).toBe(String(PAGE_SIZE));
    expect(new URL(giphyUrl('KEY', '', 0)).pathname).toBe('/v1/gifs/trending');
  });
});

describe('gif-search: response trimming', () => {
  it('keeps what the picker needs and prefers the lighter download for posting', () => {
    const page = parseGiphy({ data: [item('a1')], pagination: { total_count: 100, count: 1, offset: 0 } }, 0);
    expect(page.gifs).toEqual([
      {
        id: 'a1',
        title: 'Title a1',
        url: 'https://media1.giphy.com/media/a1/giphy-downsized.gif',
        preview: 'https://media1.giphy.com/media/a1/200w.gif',
        width: 200,
        height: 113,
      },
    ]);
    expect(page.next).toBe('1');
  });

  it('every URL it returns is one the message renderer will show as a GIF', () => {
    const page = parseGiphy({ data: [item('a1'), item('b2')], pagination: { total_count: 2, count: 2 } }, 0);
    for (const g of page.gifs) expect(gifUrl(g.url)).toBe(g.url);
  });

  it('drops anything off-host, non-https, malformed or missing — never trusts the upstream blindly', () => {
    const bad = [
      item('x1', { images: { downsized: { url: 'https://evil.example/a.gif' }, fixed_width: { url: 'https://media.giphy.com/a/200w.gif' } } }),
      item('x2', { images: { downsized: { url: 'http://media.giphy.com/a.gif' }, fixed_width: { url: 'https://media.giphy.com/a/200w.gif' } } }),
      item('x3', { images: {} }), // nothing to show
      item('../x4'),
      { id: 7 },
      null,
      'junk',
    ];
    const page = parseGiphy({ data: [...bad, item('ok')], pagination: { total_count: 8, count: 8 } }, 0);
    expect(page.gifs.map((g) => g.id)).toEqual(['ok']);
  });

  it('falls back to the downsized copy for the preview when there is no fixed-width one', () => {
    const only = item('d1', { images: { downsized: { url: 'https://media.giphy.com/a/giphy.gif', width: '300', height: '200' } } });
    const page = parseGiphy({ data: [only], pagination: { total_count: 1, count: 1 } }, 0);
    expect(page.gifs[0]).toMatchObject({ url: 'https://media.giphy.com/a/giphy.gif', preview: 'https://media.giphy.com/a/giphy.gif', width: 300 });
  });

  it('computes the next cursor, and stops at the end', () => {
    expect(parseGiphy({ data: [item('a')], pagination: { total_count: 50, count: 24 } }, 24).next).toBe('48');
    expect(parseGiphy({ data: [item('a')], pagination: { total_count: 48, count: 24 } }, 24).next).toBeNull();
    expect(parseGiphy({ data: [], pagination: { total_count: 0, count: 0 } }, 0)).toEqual({ gifs: [], next: null });
    expect(parseGiphy(null, 0)).toEqual({ gifs: [], next: null });
  });

  it('isGifUrl is strict about hosts', () => {
    expect(isGifUrl('https://media4.giphy.com/media/x/giphy.gif')).toBe(true);
    expect(isGifUrl('https://giphy.com/gifs/x')).toBe(false);
    expect(isGifUrl('https://media.giphy.com.evil.example/x.gif')).toBe(false);
    expect(isGifUrl(5)).toBe(false);
  });
});
