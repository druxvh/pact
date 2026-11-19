import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DiscoverApi, FeedsError, setDiscoverApi } from './api';
import { DISCOVER_CACHE_KEY, loadCache, parseCache, saveCache, trimForCache } from './cache';
import { CATALOG } from './catalog';
import { STALE_MS, useFeedStore } from './feedStore';
import { refOfSource, toArticle } from './logic';
import { fixtureArticles, memoryDiscoverApi, svgImage } from './memoryApi';
import type { FeedsResponse } from './types';

const ref = (id: string) => refOfSource(CATALOG.find((s) => s.id === id) as (typeof CATALOG)[number]);
const spy = (api: DiscoverApi = memoryDiscoverApi({ delayMs: 0 })) => {
  const calls: string[][] = [];
  const wrapped: DiscoverApi = {
    fetchFeeds: (urls, opts) => {
      calls.push(urls);
      return api.fetchFeeds(urls, opts);
    },
  };
  return { api: wrapped, calls };
};

describe('feed store (stale-while-revalidate)', () => {
  beforeEach(() => {
    localStorage.clear();
    useFeedStore.getState().reset();
  });
  afterEach(() => {
    setDiscoverApi(null);
    vi.useRealTimers();
  });

  it('loads feeds into slots, with their articles', async () => {
    const { api, calls } = spy();
    setDiscoverApi(api);
    await useFeedStore.getState().load([ref('bbc-news'), ref('the-verge')]);
    const { slots, pending, error } = useFeedStore.getState();
    expect(calls).toHaveLength(1);
    expect(Object.keys(slots)).toEqual([ref('bbc-news').url, ref('the-verge').url]);
    expect(slots[ref('bbc-news').url]?.items.length).toBeGreaterThan(3);
    expect(pending).toBe(0);
    expect(error).toBeNull();
  });

  it('does not fetch again while the data is fresh, but does once it is stale, or when forced', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { api, calls } = spy();
    setDiscoverApi(api);
    const feeds = [ref('nasa')];
    await useFeedStore.getState().load(feeds);
    await useFeedStore.getState().load(feeds);
    expect(calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + STALE_MS - 1000);
    await useFeedStore.getState().load(feeds);
    expect(calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2000);
    await useFeedStore.getState().load(feeds);
    expect(calls).toHaveLength(2);
    await useFeedStore.getState().load(feeds, { force: true });
    expect(calls).toHaveLength(3);
  });

  it('shares one request between overlapping loads of the same feed', async () => {
    const { api, calls } = spy(memoryDiscoverApi({ delayMs: 5 }));
    setDiscoverApi(api);
    await Promise.all([useFeedStore.getState().load([ref('nasa')]), useFeedStore.getState().load([ref('nasa')])]);
    expect(calls).toHaveLength(1);
  });

  it('asks for at most 12 feeds per request', async () => {
    const { api, calls } = spy();
    setDiscoverApi(api);
    await useFeedStore.getState().load(CATALOG.slice(0, 30).map(refOfSource));
    expect(calls.length).toBe(3);
    for (const urls of calls) expect(urls.length).toBeLessThanOrEqual(12);
  });

  it('keeps showing the old articles when a refresh fails, and says so', async () => {
    setDiscoverApi(memoryDiscoverApi({ delayMs: 0 }));
    const feeds = [ref('wired')];
    await useFeedStore.getState().load(feeds);
    const before = useFeedStore.getState().slots[feeds[0]?.url as string];
    expect(before?.items.length).toBeGreaterThan(0);

    setDiscoverApi({ fetchFeeds: () => Promise.reject(new FeedsError('offline')) });
    await useFeedStore.getState().load(feeds, { force: true });
    const after = useFeedStore.getState();
    expect(after.error).toBe('offline');
    expect(after.slots[feeds[0]?.url as string]?.items).toEqual(before?.items);
    expect(after.slots[feeds[0]?.url as string]?.error).toBe('unreachable');
    expect(after.pending).toBe(0);
  });

  it('marks single feeds that fail while the rest load', async () => {
    const partial: DiscoverApi = {
      fetchFeeds: async (urls) => {
        const all = await memoryDiscoverApi({ delayMs: 0 }).fetchFeeds(urls.slice(0, 1));
        return { feeds: all.feeds, failed: urls.slice(1).map((url) => ({ url, reason: 'not_found' })) } satisfies FeedsResponse;
      },
    };
    setDiscoverApi(partial);
    await useFeedStore.getState().load([ref('nasa'), ref('quanta')]);
    const { slots, error } = useFeedStore.getState();
    expect(slots[ref('nasa').url]?.error).toBeUndefined();
    expect(slots[ref('quanta').url]).toMatchObject({ error: 'not_found', items: [] });
    expect(error).toBeNull();
  });

  it('does not hammer a feed that just failed, then retries after a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let n = 0;
    setDiscoverApi({
      fetchFeeds: async (urls) => {
        n++;
        return { feeds: [], failed: urls.map((url) => ({ url, reason: 'unreachable' })) };
      },
    });
    const feeds = [ref('nasa')];
    await useFeedStore.getState().load(feeds);
    await useFeedStore.getState().load(feeds);
    expect(n).toBe(1);
    vi.setSystemTime(Date.now() + 61_000);
    await useFeedStore.getState().load(feeds);
    expect(n).toBe(2);
  });

  it('writes a slim cache soon after loading and paints from it on the next start', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    setDiscoverApi(memoryDiscoverApi({ delayMs: 0 }));
    await useFeedStore.getState().load([ref('the-verge')]);
    expect(localStorage.getItem(DISCOVER_CACHE_KEY)).toBeNull();
    vi.advanceTimersByTime(500);
    const raw = localStorage.getItem(DISCOVER_CACHE_KEY) as string;
    expect(raw).toBeTruthy();
    expect(raw).not.toContain('<p>'); // no article bodies on disk
    const cached = loadCache();
    expect(cached[ref('the-verge').url]?.items.length).toBeGreaterThan(0);
    expect(cached[ref('the-verge').url]?.items.every((a) => a.contentHtml === '')).toBe(true);
  });

  it('can be seeded with an already-fetched feed', () => {
    useFeedStore.getState().seed({ feeds: [{ url: 'https://example.com/feed.xml', title: 'Ex', items: [] }], failed: [] });
    expect(useFeedStore.getState().slots['https://example.com/feed.xml']?.title).toBe('Ex');
  });
});

describe('cache', () => {
  const slot = (n: number, at: number) => ({
    at,
    title: 'T',
    items: Array.from({ length: n }, (_, i) => ({
      ...(toArticle(fixtureArticles(CATALOG[0] as (typeof CATALOG)[number])[0]) as NonNullable<ReturnType<typeof toArticle>>),
      id: `id${at}x${i}`,
      contentHtml: '<p>body</p>',
    })),
  });

  it('trims to the item cap, keeping the most recently fetched feeds, and drops bodies', () => {
    const trimmed = trimForCache(
      { 'https://a.example.com/f': slot(30, 1), 'https://b.example.com/f': slot(30, 3), 'https://c.example.com/f': slot(30, 2) },
      50,
    );
    expect(Object.keys(trimmed)).toEqual(['https://b.example.com/f', 'https://c.example.com/f']);
    expect(trimmed['https://c.example.com/f']?.items).toHaveLength(20);
    expect(Object.values(trimmed).every((s) => s.items.every((a) => a.contentHtml === ''))).toBe(true);
  });

  it('reads a cache defensively', () => {
    expect(parseCache(null)).toEqual({});
    expect(parseCache('{broken')).toEqual({});
    expect(parseCache(JSON.stringify({ v: 99, feeds: {} }))).toEqual({});
    expect(
      parseCache(
        JSON.stringify({ v: 1, feeds: { 'http://insecure.example.com/f': { at: 1, items: [] }, 'https://ok.example.com/f': { at: 'x', items: [] } } }),
      ),
    ).toEqual({});
    const good = parseCache(JSON.stringify({ v: 1, feeds: { 'https://ok.example.com/f': { at: 5, title: 'Ok', items: [{ junk: 1 }, slot(1, 1).items[0]] } } }));
    expect(good['https://ok.example.com/f']?.items).toHaveLength(1);
  });

  it('survives storage that throws', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveCache({ 'https://a.example.com/f': slot(1, 1) })).not.toThrow();
    set.mockRestore();
  });
});

describe('the in-memory API', () => {
  const api = memoryDiscoverApi({ delayMs: 0, now: () => Date.parse('2026-11-17T12:00:00Z') });

  it('serves realistic, valid articles for every catalog source', async () => {
    for (const group of [CATALOG.slice(0, 12), CATALOG.slice(12, 24), CATALOG.slice(24, 36), CATALOG.slice(36, 48), CATALOG.slice(48, 60), CATALOG.slice(60)]) {
      if (!group.length) continue;
      const res = await api.fetchFeeds(
        group.map((s) => s.feed),
        { limit: 10 },
      );
      expect(res.failed).toEqual([]);
      expect(res.feeds).toHaveLength(group.length);
      for (const f of res.feeds) {
        expect(f.items.length, f.url).toBeGreaterThanOrEqual(5);
        for (const a of f.items) {
          expect(toArticle({ ...a, image: a.image?.startsWith('data:') ? null : a.image }), a.title).not.toBeNull();
          expect(Date.parse(a.publishedAt as string)).toBeLessThan(Date.parse('2026-11-17T12:00:00Z'));
        }
      }
    }
  });

  it('is deterministic, has unique ids across the catalog, and a mix of pictures, bodies and summaries', async () => {
    const all = CATALOG.flatMap((s) => fixtureArticles(s, 1_000_000_000_000));
    expect(all.length).toBeGreaterThanOrEqual(60);
    expect(new Set(all.map((a) => a.id)).size).toBe(all.length);
    expect(fixtureArticles(CATALOG[0] as (typeof CATALOG)[number], 5)).toEqual(fixtureArticles(CATALOG[0] as (typeof CATALOG)[number], 5));
    expect(all.some((a) => a.image === null)).toBe(true);
    expect(all.some((a) => a.image?.startsWith('data:image/svg+xml'))).toBe(true);
    expect(all.some((a) => a.contentHtml && a.words > 100)).toBe(true);
    expect(all.some((a) => !a.contentHtml)).toBe(true);
    expect(svgImage('x')).toBe(svgImage('x'));
  });

  it('honours the limit and answers the special addresses', async () => {
    const res = await api.fetchFeeds(
      [
        CATALOG[0]?.feed as string,
        'https://example.com/feed.xml',
        'https://example.com/hostile.xml',
        'https://example.com/broken.xml',
        'https://unknown.example.org/feed',
      ],
      { limit: 2 },
    );
    expect(res.feeds.map((f) => f.items.length)).toEqual([2, 3, 1]);
    expect(res.feeds[2]?.items[0]?.contentHtml).toContain('<script>');
    expect(res.failed).toEqual([
      { url: 'https://example.com/broken.xml', reason: 'not_a_feed' },
      { url: 'https://unknown.example.org/feed', reason: 'not_found' },
    ]);
  });
});
