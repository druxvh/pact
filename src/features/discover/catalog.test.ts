import { describe, expect, it } from 'vitest';
import { CATALOG, isTopicId, SOURCE_BY_ID, STARTER_SOURCES, sourcesForTopic, TOPIC_BY_ID, TOPIC_IDS, TOPICS } from './catalog';

describe('the source catalog', () => {
  it('is a real catalog: ids, names and feed addresses are unique', () => {
    expect(CATALOG.length).toBeGreaterThanOrEqual(45);
    expect(new Set(CATALOG.map((s) => s.id)).size).toBe(CATALOG.length);
    expect(new Set(CATALOG.map((s) => s.feed)).size).toBe(CATALOG.length);
    expect(new Set(CATALOG.map((s) => s.name)).size).toBe(CATALOG.length);
    expect(Object.keys(SOURCE_BY_ID)).toHaveLength(CATALOG.length);
  });

  it('every source has https addresses, valid topics and a language', () => {
    for (const s of CATALOG) {
      expect(s.id, s.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(new URL(s.feed).protocol, s.id).toBe('https:');
      expect(new URL(s.site).protocol, s.id).toBe('https:');
      expect(s.topics.length, s.id).toBeGreaterThan(0);
      for (const t of s.topics) expect(isTopicId(t), `${s.id}: ${t}`).toBe(true);
      expect(s.language, s.id).toMatch(/^[a-z]{2}$/);
      expect(s.name.length, s.id).toBeGreaterThan(1);
    }
  });

  it('covers every topic from the brief, each with several English sources (and few enough for one request)', () => {
    expect(TOPICS.map((t) => t.label)).toEqual([
      'Top stories',
      'Technology',
      'AI',
      'Developer',
      'Science',
      'World',
      'Business',
      'Design',
      'Culture & Entertainment',
      'Sports',
      'Health',
      'Gaming',
    ]);
    for (const t of TOPIC_IDS) {
      const n = sourcesForTopic(t).length;
      expect(n, t).toBeGreaterThanOrEqual(4);
      expect(n, t).toBeLessThanOrEqual(12);
      expect(TOPIC_BY_ID[t].id).toBe(t);
    }
  });

  it('only English sources make up a topic by default', () => {
    for (const t of TOPIC_IDS) for (const s of sourcesForTopic(t)) expect(s.language).toBe('en');
    expect(CATALOG.some((s) => s.language !== 'en')).toBe(true);
  });

  it('the starter set exists, is a spread, and fits in one request', () => {
    expect(STARTER_SOURCES.length).toBeLessThanOrEqual(12);
    for (const id of STARTER_SOURCES) expect(SOURCE_BY_ID[id], id).toBeDefined();
    const topics = new Set(STARTER_SOURCES.flatMap((id) => SOURCE_BY_ID[id]?.topics ?? []));
    expect(topics.size).toBeGreaterThanOrEqual(5);
  });

  it('knows a topic id when it sees one', () => {
    expect(isTopicId('tech')).toBe(true);
    expect(isTopicId('foryou')).toBe(false);
    expect(isTopicId(5)).toBe(false);
  });
});
