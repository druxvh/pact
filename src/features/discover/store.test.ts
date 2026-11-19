import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTER_SOURCES } from './catalog';
import { CUSTOM_FEED_CAP, READ_CAP, SAVED_CAP, toEntries } from './logic';
import { DISCOVER_KEY, useDiscoverStore } from './store';
import type { Article, Entry } from './types';

const article = (id: string): Article => ({
  id,
  title: `Title ${id}`,
  url: `https://example.com/${id}`,
  summary: 's',
  contentHtml: '<p>body</p>',
  image: null,
  author: '',
  publishedAt: '2026-11-17T10:00:00.000Z',
  categories: [],
  words: 100,
});
const entry = (id: string): Entry =>
  toEntries(
    { id: 'bbc-news', name: 'BBC News', site: 'https://www.bbc.com/news', url: 'https://feeds.bbci.co.uk/news/rss.xml', language: 'en', custom: false },
    [article(id)],
  )[0] as Entry;

const reset = () => {
  localStorage.clear();
  useDiscoverStore.setState(
    {
      followedSources: [...STARTER_SOURCES],
      followedTopics: [],
      customFeeds: [],
      hiddenSources: [],
      saved: [],
      read: [],
      density: 'grid',
      topic: 'foryou',
    },
    false,
  );
};

describe('discover store', () => {
  beforeEach(reset);

  it('starts with a spread of sources followed, so "For you" is a real page on the first visit', () => {
    expect(useDiscoverStore.getState().followedSources).toEqual([...STARTER_SOURCES]);
    expect(useDiscoverStore.getState().topic).toBe('foryou');
    expect(useDiscoverStore.getState().density).toBe('grid');
  });

  it('follows and unfollows sources — known ones only', () => {
    const s = useDiscoverStore.getState();
    s.followSource('engadget');
    s.followSource('engadget');
    s.followSource('not-a-source');
    expect(useDiscoverStore.getState().followedSources.filter((x) => x === 'engadget')).toHaveLength(1);
    expect(useDiscoverStore.getState().followedSources).not.toContain('not-a-source');
    s.unfollowSource('engadget');
    expect(useDiscoverStore.getState().followedSources).not.toContain('engadget');
  });

  it('follows and unfollows topics', () => {
    const s = useDiscoverStore.getState();
    s.toggleTopic('gaming');
    s.toggleTopic('ai');
    expect(useDiscoverStore.getState().followedTopics).toEqual(['gaming', 'ai']);
    s.toggleTopic('gaming');
    expect(useDiscoverStore.getState().followedTopics).toEqual(['ai']);
  });

  it('adds a custom feed (and follows it), once, up to a cap; removing it clears every trace', () => {
    const s = useDiscoverStore.getState();
    const id = s.addCustomFeed('https://blog.example.org/feed', '  My Blog ');
    expect(id).toMatch(/^custom-/);
    expect(useDiscoverStore.getState().customFeeds).toEqual([expect.objectContaining({ id, url: 'https://blog.example.org/feed', name: 'My Blog' })]);
    expect(useDiscoverStore.getState().followedSources).toContain(id);
    expect(s.addCustomFeed('https://blog.example.org/feed', 'again')).toBe(id);
    expect(useDiscoverStore.getState().customFeeds).toHaveLength(1);

    s.hideSource(id as string);
    s.removeCustomFeed(id as string);
    const after = useDiscoverStore.getState();
    expect(after.customFeeds).toEqual([]);
    expect(after.followedSources).not.toContain(id);
    expect(after.hiddenSources).not.toContain(id);

    for (let i = 0; i < CUSTOM_FEED_CAP; i++) expect(s.addCustomFeed(`https://b${i}.example.org/feed`, `B${i}`)).not.toBeNull();
    expect(s.addCustomFeed('https://one-too-many.example.org/feed', 'x')).toBeNull();
    expect(useDiscoverStore.getState().customFeeds).toHaveLength(CUSTOM_FEED_CAP);
  });

  it('names a custom feed after its host when the feed has no title', () => {
    useDiscoverStore.getState().addCustomFeed('https://www.example.org/rss', '  ');
    expect(useDiscoverStore.getState().customFeeds[0]?.name).toBe('example.org');
  });

  it('hides and unhides a source without touching whether it is followed', () => {
    const s = useDiscoverStore.getState();
    s.hideSource('wired');
    s.hideSource('wired');
    expect(useDiscoverStore.getState().hiddenSources).toEqual(['wired']);
    expect(useDiscoverStore.getState().followedSources).toContain('wired');
    s.unhideSource('wired');
    expect(useDiscoverStore.getState().hiddenSources).toEqual([]);
  });

  it('saves and unsaves; the saved copy has no body', () => {
    const s = useDiscoverStore.getState();
    expect(s.toggleSaved(entry('a1b2c3'), '2026-11-17T12:00:00.000Z')).toBe(true);
    const saved = useDiscoverStore.getState().saved;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ id: 'a1b2c3', savedAt: '2026-11-17T12:00:00.000Z', source: { id: 'bbc-news' } });
    expect('contentHtml' in (saved[0] as object)).toBe(false);
    expect(s.toggleSaved(entry('a1b2c3'))).toBe(false);
    expect(useDiscoverStore.getState().saved).toEqual([]);
  });

  it('keeps at most 200 saved articles, newest first, and 600 read ids', () => {
    const s = useDiscoverStore.getState();
    for (let i = 0; i < SAVED_CAP + 10; i++) s.toggleSaved(entry(`id${i}`));
    const saved = useDiscoverStore.getState().saved;
    expect(saved).toHaveLength(SAVED_CAP);
    expect(saved[0]?.id).toBe(`id${SAVED_CAP + 9}`);
    for (let i = 0; i < READ_CAP + 25; i++) s.markRead(`r${i}`);
    expect(useDiscoverStore.getState().read).toHaveLength(READ_CAP);
    expect(useDiscoverStore.getState().read[0]).toBe(`r${READ_CAP + 24}`);
  });

  it('marks read and unread', () => {
    const s = useDiscoverStore.getState();
    s.markRead('x1');
    s.markRead('x1');
    s.markRead('x2');
    expect(useDiscoverStore.getState().read).toEqual(['x2', 'x1']);
    s.markUnread('x1');
    expect(useDiscoverStore.getState().read).toEqual(['x2']);
  });

  it('remembers the density and the last view', () => {
    const s = useDiscoverStore.getState();
    s.setDensity('list');
    s.setView('gaming');
    expect(useDiscoverStore.getState()).toMatchObject({ density: 'list', topic: 'gaming' });
  });

  it('persists under "pact-discover" without any functions', () => {
    useDiscoverStore.getState().followSource('engadget');
    const raw = JSON.parse(localStorage.getItem(DISCOVER_KEY) as string) as { state: Record<string, unknown>; version: number };
    expect(raw.version).toBe(1);
    expect(Object.keys(raw.state).sort()).toEqual(['customFeeds', 'density', 'followedSources', 'followedTopics', 'hiddenSources', 'read', 'saved', 'topic']);
    expect(raw.state.followedSources).toContain('engadget');
  });

  it('loads what is on disk through the sanitiser: hostile or broken data never reaches the store', async () => {
    localStorage.setItem(
      DISCOVER_KEY,
      JSON.stringify({
        state: {
          followedSources: ['nasa', 42],
          customFeeds: [{ id: 'custom-x1', url: 'javascript:alert(1)', name: 'bad' }],
          saved: [{ id: 'abc123', title: 'T', url: 'javascript:alert(1)', source: { id: 's', name: 'S' } }],
          density: 'list',
          topic: 'not-a-topic',
          read: 'nope',
        },
        version: 1,
      }),
    );
    await useDiscoverStore.persist.rehydrate();
    const s = useDiscoverStore.getState();
    expect(s.followedSources).toEqual(['nasa']);
    expect(s.customFeeds).toEqual([]);
    expect(s.saved).toEqual([]);
    expect(s.density).toBe('list');
    expect(s.topic).toBe('foryou'); // invalid → the default stays
    expect(s.read).toEqual([]);
  });

  it('survives unparseable storage', async () => {
    localStorage.setItem(DISCOVER_KEY, '{not json');
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    await useDiscoverStore.persist.rehydrate();
    expect(useDiscoverStore.getState().followedSources.length).toBeGreaterThan(0);
    warn.mockRestore();
  });
});
