import { describe, expect, it } from 'vitest';
import { BANGS, bangsMatching, bangUrl, chipFor, findBang, parseBang } from '@/lib/omnibox/bangs';

describe('bangs table', () => {
  it('has unique triggers and a %s in every search url', () => {
    const seen = new Set<string>();
    for (const b of BANGS) {
      expect(b.url).toContain('%s');
      expect(() => new URL(b.url.replace('%s', 'x'))).not.toThrow();
      expect(() => new URL(b.home)).not.toThrow();
      for (const t of b.triggers) {
        expect(seen.has(t), `duplicate trigger ${t}`).toBe(false);
        seen.add(t);
      }
    }
    expect(BANGS.length).toBeGreaterThanOrEqual(20);
  });
});

describe('parseBang', () => {
  it('reads prefix and suffix bangs', () => {
    expect(parseBang('!yt lofi beats')).toMatchObject({ bang: { id: 'youtube' }, rest: 'lofi beats', style: 'prefix' });
    expect(parseBang('!gh pact')?.bang.id).toBe('github');
    expect(parseBang('lofi beats !yt')).toMatchObject({ bang: { id: 'youtube' }, rest: 'lofi beats', style: 'suffix' });
    expect(parseBang('!YT lofi')?.bang.id).toBe('youtube');
    expect(parseBang('!maps')).toMatchObject({ bang: { id: 'maps' }, rest: '' });
  });

  it('leaves unknown bangs and ordinary text alone', () => {
    expect(parseBang('!important')).toBeNull();
    expect(parseBang('hello !nope')).toBeNull();
    expect(parseBang('yt lofi')).toBeNull();
    expect(parseBang('wow!')).toBeNull();
    expect(parseBang('')).toBeNull();
  });
});

describe('bangUrl', () => {
  it('encodes the query, or opens the site when there is none', () => {
    const yt = findBang('yt');
    expect(yt && bangUrl(yt, 'lofi & chill')).toBe('https://www.youtube.com/results?search_query=lofi%20%26%20chill');
    expect(yt && bangUrl(yt, '  ')).toBe('https://www.youtube.com/');
  });
});

describe('chipFor (what Tab turns into a chip)', () => {
  it('takes a bang with or without text, and bare triggers of two or more letters', () => {
    expect(chipFor('!yt lofi')).toMatchObject({ bang: { id: 'youtube' }, rest: 'lofi' });
    expect(chipFor('!w')).toMatchObject({ bang: { id: 'wikipedia' }, rest: '' });
    expect(chipFor('yt')).toMatchObject({ bang: { id: 'youtube' }, rest: '' });
    expect(chipFor('GitHub')).toMatchObject({ bang: { id: 'github' } });
  });

  it('never turns a single bare letter or a longer phrase into a chip', () => {
    expect(chipFor('w')).toBeNull(); // would hijack Tab for the word "w"
    expect(chipFor('r')).toBeNull();
    expect(chipFor('yt lofi')).toBeNull();
    expect(chipFor('hello')).toBeNull();
  });
});

describe('bangsMatching', () => {
  it('matches trigger or name prefixes', () => {
    expect(bangsMatching('yout').map((b) => b.id)).toEqual(['youtube']);
    expect(bangsMatching('g').map((b) => b.id)).toContain('github');
    expect(bangsMatching('stack').map((b) => b.id)).toEqual(['stackoverflow']);
    expect(bangsMatching('')).toEqual([]);
  });
});
