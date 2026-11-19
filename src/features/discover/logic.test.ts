import { describe, expect, it } from 'vitest';
import { CATALOG, STARTER_SOURCES, sourcesForTopic, TOPIC_FOLLOW_SOURCES } from './catalog';
import {
  addRead,
  addSaved,
  CUSTOM_FEED_CAP,
  capList,
  chunk,
  DIVERSITY_MS,
  describeFeedFailure,
  feedIdFor,
  feedsForView,
  hostOf,
  initialsOf,
  isHttpsUrl,
  normalizeFeedInput,
  pickHero,
  READ_CAP,
  rankEntries,
  readMinutes,
  SAVED_CAP,
  sanitizeDiscoverData,
  savedToEntry,
  searchEntries,
  sourceHue,
  toArticle,
  toEntries,
  toFeedsResponse,
  toSaved,
} from './logic';
import type { Article, CustomFeed, Entry, FeedRef } from './types';

const NOW = Date.parse('2026-11-17T12:00:00Z');
const HOUR = 3_600_000;

const article = (id: string, over: Partial<Article> = {}): Article => ({
  id,
  title: `Title ${id}`,
  url: `https://example.com/${id}`,
  summary: `Summary ${id}`,
  contentHtml: '',
  image: null,
  author: '',
  publishedAt: new Date(NOW - HOUR).toISOString(),
  categories: [],
  words: 0,
  ...over,
});
const feed = (id: string, name = id): FeedRef => ({
  id,
  name,
  site: `https://${id}.example.com`,
  url: `https://${id}.example.com/feed`,
  language: 'en',
  custom: false,
});
const entry = (id: string, source = 's1', hoursAgo = 1, over: Partial<Article> = {}): Entry =>
  toEntries(feed(source), [article(id, { publishedAt: new Date(NOW - hoursAgo * HOUR).toISOString(), ...over })])[0] as Entry;

describe('small helpers', () => {
  it('chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it('gives a source the same hue every time, and different sources different hues', () => {
    expect(sourceHue('bbc-news')).toBe(sourceHue('bbc-news'));
    expect(sourceHue('bbc-news')).toBeGreaterThanOrEqual(0);
    expect(sourceHue('bbc-news')).toBeLessThan(360);
    expect(new Set(CATALOG.map((s) => sourceHue(s.id))).size).toBeGreaterThan(30);
  });

  it('makes initials for a tile', () => {
    expect(initialsOf('BBC News')).toBe('BN');
    expect(initialsOf('The Guardian')).toBe('TG');
    expect(initialsOf('WIRED')).toBe('WI');
    expect(initialsOf('Space.com')).toBe('SC');
    expect(initialsOf('  ')).toBe('?');
    expect(initialsOf('ЖУРНАЛ мир')).toBe('ЖМ');
  });

  it('reads hosts and read times', () => {
    expect(hostOf('https://www.theverge.com/a')).toBe('theverge.com');
    expect(hostOf('nope')).toBe('');
    expect(readMinutes(0)).toBeNull();
    expect(readMinutes(39)).toBeNull();
    expect(readMinutes(40)).toBe(1);
    expect(readMinutes(460)).toBe(2);
    expect(readMinutes(2300)).toBe(10);
  });

  it('knows an https URL', () => {
    expect(isHttpsUrl('https://example.com/a')).toBe(true);
    for (const v of ['http://example.com', 'javascript:alert(1)', 'https://u:p@example.com', 5, null, 'x'.repeat(3000)]) expect(isHttpsUrl(v)).toBe(false);
  });
});

describe('trusting nothing the network returns', () => {
  it('accepts a good article and cleans its fields', () => {
    const a = toArticle({ ...article('abc123'), summary: 'x'.repeat(500), categories: ['a', 5, 'b', 'c', 'd', 'e', 'f'], words: 120.7 });
    expect(a?.summary).toHaveLength(400);
    expect(a?.categories).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(a?.words).toBe(120);
  });

  it('refuses articles with no usable id, title or https address, and drops bad pictures and dates', () => {
    expect(toArticle(null)).toBeNull();
    expect(toArticle({ ...article('abc123'), id: '../../x' })).toBeNull();
    expect(toArticle({ ...article('abc123'), title: '   ' })).toBeNull();
    expect(toArticle({ ...article('abc123'), url: 'http://example.com/a' })).toBeNull();
    expect(toArticle({ ...article('abc123'), url: 'javascript:alert(1)' })).toBeNull();
    expect(toArticle({ ...article('abc123'), image: 'javascript:alert(1)' })?.image).toBeNull();
    expect(toArticle({ ...article('abc123'), image: 'http://example.com/a.jpg' })?.image).toBeNull();
    expect(toArticle({ ...article('abc123'), publishedAt: 'whenever' })?.publishedAt).toBeNull();
    expect(toArticle({ ...article('abc123'), words: -5 })?.words).toBe(0);
    expect(toArticle({ ...article('abc123'), words: 'many' })?.words).toBe(0);
  });

  it('reads a whole response, and refuses anything else', () => {
    const ok = toFeedsResponse({
      ok: true,
      feeds: [
        { url: 'https://example.com/feed', title: 'T', items: [article('abc123'), { nonsense: true }, null] },
        { url: 'http://insecure.example.com/feed', items: [] },
        'x',
      ],
      failed: [{ url: 'https://example.com/dead', reason: 'not_found' }, { reason: 'x' }, 5],
    });
    expect(ok?.feeds).toHaveLength(1);
    expect(ok?.feeds[0]?.items).toHaveLength(1);
    expect(ok?.failed).toEqual([{ url: 'https://example.com/dead', reason: 'not_found' }]);
    for (const bad of [null, 'x', { ok: false }, { ok: true }, { ok: true, feeds: 'x' }, [], undefined]) expect(toFeedsResponse(bad)).toBeNull();
  });
});

describe('which feeds make up a view', () => {
  const none = { followedSources: [] as string[], followedTopics: [] as never[], customFeeds: [] as CustomFeed[], hiddenSources: [] as string[] };
  const urls = (refs: FeedRef[]) => refs.map((r) => r.id);

  it('"For you" is the followed sources, in order', () => {
    expect(urls(feedsForView('foryou', { ...none, followedSources: ['the-verge', 'nasa'] }))).toEqual(['the-verge', 'nasa']);
    expect(feedsForView('foryou', none)).toEqual([]);
  });

  it('following a topic brings in the first few English sources of it, without duplicates', () => {
    const refs = feedsForView('foryou', { ...none, followedSources: ['the-verge'], followedTopics: ['tech'] });
    expect(urls(refs)).toEqual(
      [
        'the-verge',
        ...sourcesForTopic('tech')
          .map((s) => s.id)
          .filter((id) => id !== 'the-verge')
          .slice(0, TOPIC_FOLLOW_SOURCES - 1),
      ].slice(0, refs.length),
    );
    expect(refs.length).toBeLessThanOrEqual(TOPIC_FOLLOW_SOURCES + 1);
    expect(new Set(refs.map((r) => r.url)).size).toBe(refs.length);
  });

  it('a topic shows its English sources, plus a followed source in another language that carries it', () => {
    const plain = urls(feedsForView('world', none));
    expect(plain).not.toContain('bbc-mundo');
    expect(plain).toContain('al-jazeera');
    const withSpanish = urls(feedsForView('world', { ...none, followedSources: ['bbc-mundo', 'nasa'] }));
    expect(withSpanish).toContain('bbc-mundo');
    expect(withSpanish).not.toContain('nasa'); // not a world source
  });

  it('hidden sources are in no view at all', () => {
    const hidden = { ...none, followedSources: ['the-verge', 'wired'], hiddenSources: ['wired', 'engadget'] };
    expect(urls(feedsForView('foryou', hidden))).toEqual(['the-verge']);
    expect(urls(feedsForView('tech', hidden))).not.toContain('wired');
    expect(urls(feedsForView('tech', hidden))).not.toContain('engadget');
  });

  it('custom feeds appear in "For you" while followed, and never in a topic', () => {
    const custom: CustomFeed = { id: 'custom-abc', url: 'https://blog.example.org/feed', name: 'My blog', addedAt: '2026-11-01T00:00:00Z' };
    const f = { ...none, customFeeds: [custom], followedSources: ['custom-abc'] };
    expect(feedsForView('foryou', f)[0]).toMatchObject({ id: 'custom-abc', url: custom.url, custom: true, site: 'https://blog.example.org' });
    expect(urls(feedsForView('tech', f))).not.toContain('custom-abc');
    expect(feedsForView('foryou', { ...f, followedSources: [] })).toEqual([]); // added but unfollowed
  });

  it('the reading list needs no feeds', () => {
    expect(feedsForView('saved', { ...none, followedSources: ['nasa'] })).toEqual([]);
  });

  it('every view fits in one request of 12 feeds (the starter set too)', () => {
    expect(STARTER_SOURCES.length).toBeLessThanOrEqual(12);
    for (const t of ['top', 'tech', 'ai', 'dev', 'science', 'world', 'business', 'design', 'culture', 'sports', 'health', 'gaming'] as const)
      expect(feedsForView(t, none).length, t).toBeLessThanOrEqual(12);
  });
});

describe('ranking', () => {
  it('puts the newest first', () => {
    const ranked = rankEntries([entry('old', 'a', 30), entry('new', 'b', 1), entry('mid', 'c', 10)], NOW);
    expect(ranked.map((e) => e.id)).toEqual(['new', 'mid', 'old']);
  });

  it('keeps one prolific source from filling the page: its later stories are pushed back', () => {
    const flood = Array.from({ length: 8 }, (_, i) => entry(`f${i}`, 'flood', 1 + i * 0.5));
    const others = [entry('o1', 'other1', 3), entry('o2', 'other2', 4), entry('o3', 'other3', 5)];
    const ranked = rankEntries([...flood, ...others], NOW).map((e) => e.id);
    // without the penalty all eight "flood" stories (1–4.5 h old) would precede o2 and o3
    expect(ranked.indexOf('o1')).toBeLessThan(ranked.indexOf('f4'));
    expect(ranked.indexOf('o3')).toBeLessThan(ranked.indexOf('f7'));
    // but within a source the order is still newest first
    const fs = ranked.filter((id) => id.startsWith('f'));
    expect(fs).toEqual([...fs].sort());
    expect(DIVERSITY_MS).toBe(45 * 60_000);
  });

  it('removes the same article seen twice', () => {
    const ranked = rankEntries([entry('same', 'a', 2), entry('same', 'b', 1), entry('x', 'c', 3)], NOW);
    expect(ranked.map((e) => e.id).sort()).toEqual(['same', 'x']);
  });

  it('sorts undated stories as a week old, clamps the future, and is stable on ties', () => {
    const undated = entry('undated', 'a', 1, { publishedAt: null });
    const future = entry('future', 'b', 1, { publishedAt: new Date(NOW + 5 * 24 * HOUR).toISOString() });
    const recent = entry('recent', 'c', 2);
    const ranked = rankEntries([undated, recent, future], NOW).map((e) => e.id);
    expect(ranked[ranked.length - 1]).toBe('undated');
    expect(ranked[0]).toBe('future'); // clamped to "now", not "in five days"
    expect(rankEntries([], NOW)).toEqual([]);
  });
});

describe('search, hero, saving', () => {
  const entries = [
    entry('1', 'bbc', 1, { title: 'Floods hit the coast', summary: 'Rain all week', author: 'Ana Ruiz', categories: ['Weather'] }),
    entry('2', 'verge', 2, { title: 'A new phone', summary: 'It folds', author: 'Sam' }),
    entry('3', 'bbc', 3, { title: 'Coast path reopens', summary: 'After the floods' }),
  ];

  it('matches every word anywhere in the title, summary, source, author or categories', () => {
    expect(searchEntries(entries, 'floods').map((e) => e.id)).toEqual(['1', '3']);
    expect(searchEntries(entries, 'floods coast').map((e) => e.id)).toEqual(['1', '3']);
    expect(searchEntries(entries, 'floods reopens').map((e) => e.id)).toEqual(['3']);
    expect(searchEntries(entries, 'ana').map((e) => e.id)).toEqual(['1']);
    expect(searchEntries(entries, 'weather').map((e) => e.id)).toEqual(['1']);
    expect(searchEntries(entries, 'verge').map((e) => e.id)).toEqual(['2']);
    expect(searchEntries(entries, 'zzz')).toEqual([]);
    expect(searchEntries(entries, '   ')).toHaveLength(3);
  });

  it('the hero is the first of the freshest few with a picture, else the first story', () => {
    const e = (id: string, image: string | null) => entry(id, 's', 1, { image });
    expect(pickHero([e('a', null), e('b', 'https://img.example.com/b.jpg'), e('c', 'https://img.example.com/c.jpg')])).toBe(1);
    expect(pickHero([e('a', null), e('b', null)])).toBe(0);
    expect(pickHero(Array.from({ length: 10 }, (_, i) => e(`x${i}`, i === 9 ? 'https://img.example.com/x.jpg' : null)))).toBe(0); // the picture is too far down
    expect(pickHero([])).toBe(-1);
  });

  it('saves without the body or the feed, and a saved article can come back as an entry', () => {
    const e = entry('abc', 's1', 1, { contentHtml: '<p>long body</p>', words: 400 });
    const saved = toSaved(e, '2026-11-17T12:00:00.000Z');
    expect('contentHtml' in saved).toBe(false);
    expect('feedUrl' in saved).toBe(false);
    expect(saved).toMatchObject({ id: 'abc', savedAt: '2026-11-17T12:00:00.000Z', words: 400, source: { id: 's1' } });
    expect(savedToEntry(saved)).toMatchObject({ id: 'abc', contentHtml: '', title: e.title });
  });
});

describe('adding a feed by address', () => {
  it.each([
    ['https://blog.example.org/feed.xml', 'https://blog.example.org/feed.xml'],
    ['  blog.example.org/feed  ', 'https://blog.example.org/feed'],
    ['http://blog.example.org/rss', 'https://blog.example.org/rss'],
    ['https://blog.example.org/feed#top', 'https://blog.example.org/feed'],
    ['HTTPS://Blog.Example.org:443/Feed', 'https://blog.example.org/Feed'],
  ])('accepts %s', (input, url) => {
    expect(normalizeFeedInput(input)).toEqual({ ok: true, url });
  });

  it.each([
    '',
    '   ',
    'not a url at all',
    'javascript:alert(1)',
    'ftp://example.com/feed',
    'file:///etc/passwd',
    'https://user:pw@example.com/feed',
    'https://localhost/feed',
    'https://127.0.0.1/feed',
    'https://192.168.1.10/feed',
    'https://[::1]/feed',
    'https://intranet/feed',
    'https://nas.local/feed',
    'https://example.com:8443/feed',
    `https://example.com/${'a'.repeat(2100)}`,
  ])('refuses %j', (input) => {
    expect(normalizeFeedInput(input).ok).toBe(false);
  });

  it('gives a feed the same id for the same address, and says what went wrong in words', () => {
    expect(feedIdFor('https://a.example.com/feed')).toBe(feedIdFor('https://a.example.com/feed'));
    expect(feedIdFor('https://a.example.com/feed')).not.toBe(feedIdFor('https://b.example.com/feed'));
    expect(feedIdFor('https://a.example.com/feed')).toMatch(/^custom-[a-z0-9]{1,12}$/);
    for (const r of ['not_a_feed', 'empty', 'not_found', 'refused', 'blocked', 'invalid_url', 'too_many_redirects', 'unreachable', 'whatever'])
      expect(describeFeedFailure(r).length).toBeGreaterThan(10);
  });
});

describe('what is kept on the device', () => {
  it('caps a list, newest first, without duplicates', () => {
    expect(capList([1, 2, 2, 3, 4], String, 3)).toEqual([1, 2, 3]);
  });

  it('keeps at most 200 saved articles (newest first) and 600 read ids', () => {
    let saved = [] as ReturnType<typeof toSaved>[];
    for (let i = 0; i < SAVED_CAP + 20; i++) saved = addSaved(saved, toSaved(entry(`a${i}`), new Date(NOW + i * 1000).toISOString()));
    expect(saved).toHaveLength(SAVED_CAP);
    expect(saved[0]?.id).toBe(`a${SAVED_CAP + 19}`);
    expect(addSaved(saved, toSaved(entry(`a${SAVED_CAP + 19}`)))).toHaveLength(SAVED_CAP); // saving it again doesn't duplicate

    let read: string[] = [];
    for (let i = 0; i < READ_CAP + 50; i++) read = addRead(read, `r${i}`);
    expect(read).toHaveLength(READ_CAP);
    expect(read[0]).toBe(`r${READ_CAP + 49}`);
    expect(addRead(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
  });

  it('coerces whatever is in storage: wrong types, hostile values, over-long lists', () => {
    const clean = sanitizeDiscoverData({
      followedSources: ['bbc-news', 5, '', 'x'.repeat(200), 'bbc-news', 'nasa'],
      followedTopics: ['tech', 'nonsense', 7, 'tech'],
      hiddenSources: 'not an array',
      read: Array.from({ length: 900 }, (_, i) => `id${i}`),
      customFeeds: [
        { id: 'custom-abc', url: 'https://blog.example.org/feed', name: 'x'.repeat(200), addedAt: '2026-11-01T00:00:00Z' },
        { id: 'custom-def', url: 'javascript:alert(1)', name: 'bad' },
        { id: '../../etc', url: 'https://example.org/feed', name: 'bad id' },
        null,
      ],
      saved: [
        {
          ...article('good123'),
          source: { id: 's', name: 'Source', site: 'https://s.example.com' },
          savedAt: '2026-11-10T00:00:00Z',
          contentHtml: '<script>alert(1)</script>',
        },
        { ...article('nosource') },
        { ...article('badurl'), url: 'http://example.com', source: { id: 's', name: 'S' } },
        'junk',
      ],
      density: 'huge',
      topic: 'nonsense',
    });
    expect(clean.followedSources).toEqual(['bbc-news', 'nasa']);
    expect(clean.followedTopics).toEqual(['tech']);
    expect(clean.hiddenSources).toBeUndefined();
    expect(clean.read).toHaveLength(READ_CAP);
    expect(clean.customFeeds).toHaveLength(1);
    expect(clean.customFeeds?.[0]?.name).toHaveLength(60);
    expect(clean.saved).toHaveLength(1);
    expect(clean.saved?.[0] && 'contentHtml' in clean.saved[0]).toBe(false);
    expect(clean.density).toBeUndefined();
    expect(clean.topic).toBeUndefined();
    expect(sanitizeDiscoverData(null)).toEqual({});
    expect(sanitizeDiscoverData([])).toEqual({});
    expect(sanitizeDiscoverData({ density: 'list', topic: 'saved' })).toEqual({ density: 'list', topic: 'saved' });
  });

  it('caps custom feeds and sorts saved articles newest first', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `custom-${i}`,
      url: `https://b${i}.example.org/feed`,
      name: `Blog ${i}`,
      addedAt: '2026-11-01T00:00:00Z',
    }));
    expect(sanitizeDiscoverData({ customFeeds: many }).customFeeds).toHaveLength(CUSTOM_FEED_CAP);
    const src = { id: 's', name: 'S', site: 'https://s.example.com' };
    const out = sanitizeDiscoverData({
      saved: [
        { ...article('older123'), source: src, savedAt: '2026-11-01T00:00:00Z' },
        { ...article('newer123'), source: src, savedAt: '2026-11-09T00:00:00Z' },
      ],
    });
    expect(out.saved?.map((s) => s.id)).toEqual(['newer123', 'older123']);
  });
});
