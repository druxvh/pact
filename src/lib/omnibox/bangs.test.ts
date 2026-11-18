import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BANGS,
  type Bang,
  bangById,
  bangNeedsClipboard,
  bangsMatching,
  bangUrl,
  chipFor,
  findBang,
  parseBang,
  parseCustomAlias,
  setCustomBangs,
} from '@/lib/omnibox/bangs';

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

describe('the user’s own quicklinks join the table', () => {
  const mine: Bang = {
    id: 'ql:1',
    name: 'Jira',
    triggers: ['jira'],
    url: 'https://acme.atlassian.net/browse/{query}',
    home: 'https://acme.atlassian.net/',
    custom: true,
  };
  const clip: Bang = { id: 'ql:2', name: 'Paste search', triggers: ['ps'], url: 'https://x.example/?q={clipboard}', home: 'https://x.example/', custom: true };
  const shadow: Bang = {
    id: 'ql:3',
    name: 'Shadow',
    triggers: ['gh', 'a-b'],
    url: 'https://shadow.example/?q={query}',
    home: 'https://shadow.example/',
    custom: true,
  };
  beforeEach(() => setCustomBangs([mine, clip, shadow]));
  afterEach(() => setCustomBangs([]));

  it('is found like a built-in: by trigger, id, `!alias`, suffix form, and Tab', () => {
    expect(findBang('JIRA')?.id).toBe('ql:1');
    expect(bangById('ql:1')?.name).toBe('Jira');
    expect(bangById('youtube')?.name).toBe('YouTube');
    expect(parseBang('!jira PACT-12')).toMatchObject({ bang: { id: 'ql:1' }, rest: 'PACT-12', style: 'prefix' });
    expect(parseBang('PACT-12 !jira')).toMatchObject({ bang: { id: 'ql:1' }, rest: 'PACT-12', style: 'suffix' });
    expect(chipFor('jira')).toMatchObject({ bang: { id: 'ql:1' }, rest: '' });
    expect(chipFor('!jira PACT-12')).toMatchObject({ rest: 'PACT-12' });
  });

  it('`alias text` becomes a chip only for the user’s own aliases', () => {
    expect(chipFor('jira PACT-12')).toMatchObject({ bang: { id: 'ql:1' }, rest: 'PACT-12' });
    expect(parseCustomAlias('jira   PACT-12 and more')).toMatchObject({ rest: 'PACT-12 and more' });
    expect(parseCustomAlias('jira')).toBeNull();
    expect(parseCustomAlias('nope text')).toBeNull();
    expect(chipFor('gh react')).toBeNull(); // `gh` belongs to GitHub even if a custom one claims it
  });

  it('a built-in trigger always wins over a custom one', () => {
    expect(findBang('gh')?.id).toBe('github');
    expect(parseBang('!gh pact')?.bang.id).toBe('github');
  });

  it('aliases may contain dashes', () => {
    expect(parseBang('!a-b hello')).toMatchObject({ bang: { id: 'ql:3' }, rest: 'hello' });
  });

  it('fills {query} (encoded), opens the site with nothing typed, and {clipboard} comes from the caller', () => {
    expect(bangUrl(mine, 'PACT 12/x')).toBe('https://acme.atlassian.net/browse/PACT%2012%2Fx');
    expect(bangUrl(mine, '  ')).toBe('https://acme.atlassian.net/');
    expect(bangUrl(clip, '', 'hello world')).toBe('https://x.example/?q=hello%20world');
    expect(bangNeedsClipboard(clip)).toBe(true);
    expect(bangNeedsClipboard(mine)).toBe(false);
    expect(bangNeedsClipboard(BANGS[0] as Bang)).toBe(false);
  });

  it('built-in bang lists never include the user’s (their rows come from the commands provider)', () => {
    expect(bangsMatching('jir')).toEqual([]);
  });

  it('removing them takes them out of every lookup', () => {
    setCustomBangs([]);
    expect(findBang('jira')).toBeUndefined();
    expect(chipFor('jira PACT-12')).toBeNull();
    expect(bangById('ql:1')).toBeUndefined();
  });
});
