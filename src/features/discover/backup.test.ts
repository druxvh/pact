import { describe, expect, it } from 'vitest';
import { AREA_BY_KEY, NOT_BACKED_UP } from '@/lib/backup/areas';
import { mergeColl } from '@/lib/backup/plan';
import { prepareBundle } from '@/lib/backup/prepare';
import type { Bundle } from '@/lib/backup/types';
import { DISCOVER_CACHE_KEY } from './cache';
import { SAVED_CAP } from './logic';
import { DISCOVER_KEY } from './store';

const NOW = '2026-11-17T12:00:00.000Z';
const env = (state: unknown, version = 1) => JSON.stringify({ state, version });
const bundle = (data: Record<string, string>): Bundle => ({ exportedAt: NOW, appVersion: 't', account: null, data, wallpaper: null });
const prepare = (state: unknown, version = 1) => prepareBundle(bundle({ [DISCOVER_KEY]: env(state, version) }), NOW);
const saved = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Title ${id}`,
  url: `https://example.com/${id}`,
  summary: 'Summary',
  image: null,
  author: '',
  publishedAt: NOW,
  categories: [],
  words: 0,
  source: { id: 'bbc-news', name: 'BBC News', site: 'https://www.bbc.com/news' },
  savedAt: NOW,
  ...over,
});
const stateOf = (p: ReturnType<typeof prepare>) => (p.areas[0]?.state ?? {}) as Record<string, unknown>;

describe('Discover in backups', () => {
  it('is an area (preferences and the reading list travel); the fetched-articles cache is not', () => {
    expect(AREA_BY_KEY[DISCOVER_KEY]).toBeDefined();
    expect(AREA_BY_KEY[DISCOVER_CACHE_KEY]).toBeUndefined();
    expect(NOT_BACKED_UP[DISCOVER_CACHE_KEY]).toMatch(/cache/);
  });

  it('keeps a good backup whole', () => {
    const state = {
      followedSources: ['bbc-news', 'nasa'],
      followedTopics: ['tech'],
      customFeeds: [{ id: 'custom-abc1', url: 'https://blog.example.org/feed', name: 'My blog', addedAt: NOW }],
      hiddenSources: ['wired'],
      saved: [saved('abc123')],
      read: ['abc123', 'def456'],
      density: 'list',
      topic: 'gaming',
    };
    const p = prepare(state);
    expect(p.areas).toHaveLength(1);
    expect(p.areas[0]?.strict).toBe(true);
    expect(p.warnings).toEqual([]);
    expect(stateOf(p)).toMatchObject(state);
  });

  it('never lets hostile values through: javascript: addresses, odd ids, wrong types, unknown fields', () => {
    const p = prepare({
      followedSources: ['ok', 5, null],
      followedTopics: ['tech', 'nonsense'],
      customFeeds: [
        { id: 'custom-abc1', url: 'javascript:alert(1)', name: 'x', addedAt: NOW },
        { id: '../../x', url: 'https://example.org/feed', name: 'x', addedAt: NOW },
        { id: 'custom-ok1', url: 'http://insecure.example.org/feed', name: 'x', addedAt: NOW },
        { id: 'custom-ok2', url: 'https://user:pw@example.org/feed', name: 'x', addedAt: NOW },
      ],
      saved: [
        saved('good123'),
        saved('badurl', { url: 'javascript:alert(1)' }),
        saved('httpurl', { url: 'http://example.com/a' }),
        saved('badimg', { image: 'javascript:alert(1)' }),
        saved('nosource', { source: null }),
        saved('../x'),
        { id: 'abc999', title: '', url: 'https://example.com/x', source: { id: 's', name: 'S' } },
        'junk',
      ],
      density: 'giant',
      topic: '<script>',
      __proto__: { polluted: true },
      extra: 'dropped',
    });
    const s = stateOf(p);
    expect(s.followedSources).toEqual(['ok']);
    expect(s.followedTopics).toEqual(['tech']);
    expect(s.customFeeds).toEqual([]);
    expect((s.saved as Array<{ id: string; image?: unknown }>).map((x) => x.id)).toEqual(['good123', 'badimg']);
    expect((s.saved as Array<{ id: string; image?: unknown }>)[1]?.image).toBeUndefined();
    expect(s.density).toBeUndefined();
    expect(s.topic).toBeUndefined();
    expect('extra' in s).toBe(false);
    expect(p.warnings.length).toBeGreaterThan(0);
  });

  it('caps the reading list at 200 when a backup carries more', () => {
    const many = Array.from({ length: SAVED_CAP + 30 }, (_, i) => saved(`id${i}00`, { savedAt: new Date(Date.parse(NOW) + i * 1000).toISOString() }));
    const s = stateOf(prepare({ saved: many }));
    expect((s.saved as unknown[]).length).toBe(SAVED_CAP);
  });

  it('merging keeps both reading lists (newest first, no duplicates, still capped) and unions the rest', () => {
    const area = AREA_BY_KEY[DISCOVER_KEY];
    const savedColl = area?.colls.find((c) => c.field === 'saved');
    expect(savedColl).toBeDefined();
    if (!area || !savedColl) return;
    const mine = [saved('aaa111', { savedAt: '2026-11-01T00:00:00.000Z' }), saved('shared1', { savedAt: '2026-11-03T00:00:00.000Z' })];
    const theirs = [saved('shared1', { savedAt: '2026-11-03T00:00:00.000Z' }), saved('bbb222', { savedAt: '2026-11-05T00:00:00.000Z' })];
    const merged = mergeColl(savedColl, mine, theirs) as Array<{ id: string }>;
    expect(merged.map((x) => x.id).sort()).toEqual(['aaa111', 'bbb222', 'shared1']);
    const repaired = area.repair?.({ saved: merged, read: ['a', 'a', 'b'], followedSources: ['x', 'x'] }, NOW) as Record<string, unknown>;
    expect((repaired.saved as Array<{ id: string }>).map((x) => x.id)).toEqual(['bbb222', 'shared1', 'aaa111']);
    expect(repaired.read).toEqual(['a', 'b']);
    expect(repaired.followedSources).toEqual(['x']);
  });
});
