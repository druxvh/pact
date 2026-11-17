import { Search } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { ghostFor, registeredProviders, registerProvider, runOmnibox, scoreFields } from '@/lib/omnibox/engine';
import { emptyUsage, recordUsage, togglePinned } from '@/lib/omnibox/frecency';
import type { Group, OmniCtx, OmniResult, Provider } from '@/lib/omnibox/types';

const ctx = (over: Partial<OmniCtx> = {}) =>
  ({
    surface: 'palette',
    now: new Date('2026-11-17T12:00:00Z'),
    locale: 'en-US',
    signedIn: true,
    refresh: () => {},
    scope: null,
    pinned: [],
    ...over,
  }) as OmniCtx;
const NOOP = { id: 'go', label: 'Go', run: () => {} };

const result = (id: string, group: Group, title: string, q: string, over: Partial<OmniResult> = {}): OmniResult => {
  const { score, matches } = scoreFields(q, title);
  return { id, group, title, icon: Search, score, matches, primary: NOOP, ...over };
};

const item = (group: Group, title: string, id = `${group}:${title}`): Provider => {
  return (q) => [result(id, group, title, q)];
};

describe('runOmnibox', () => {
  it('orders answer, top hit, groups by best match, and web last', () => {
    const providers: Provider[] = [
      (q) => [result('w', 'web', 'Search the web', q, { score: 1 })],
      (q) => [result('n', 'notes', 'Notes about timers', q)],
      (q) => [result('p', 'pages', 'Timer', q)],
      () => [{ id: 'answer', group: 'answer', title: '4', icon: Search, score: 5000, primary: NOOP, frecencyKey: null }],
      () => [{ id: 't', group: 'top', title: 'Top', icon: Search, score: 1500, primary: NOOP }],
    ];
    const view = runOmnibox('timer', ctx(), providers, emptyUsage());
    expect(view.sections.map((s) => s.id)).toEqual(['answer', 'top', 'pages', 'notes', 'web']);
    expect(view.results.map((r) => r.id)).toEqual(['answer', 't', 'p', 'n', 'w']);
  });

  it('keeps one answer and one top hit, and caps groups', () => {
    const many: Provider = (q) => Array.from({ length: 10 }, (_, i) => result(`n${i}`, 'notes', `note ${i}`, q));
    const tops: Provider = () => [
      { id: 'a', group: 'top', title: 'A', icon: Search, score: 100, primary: NOOP },
      { id: 'b', group: 'top', title: 'B', icon: Search, score: 200, primary: NOOP },
    ];
    const view = runOmnibox('note', ctx(), [many, tops], emptyUsage(), { caps: { notes: 3 } });
    expect(view.sections.find((s) => s.id === 'notes')?.results).toHaveLength(3);
    expect(view.sections.find((s) => s.id === 'top')?.results.map((r) => r.id)).toEqual(['b']);
    expect(runOmnibox('note', ctx(), [many], emptyUsage()).results).toHaveLength(6); // default cap
    expect(runOmnibox('note', ctx(), [many], emptyUsage(), { maxTotal: 4 }).results).toHaveLength(4);
  });

  it('moves a losing top hit to its fallback group instead of dropping it', () => {
    const p: Provider = (q) => [
      { id: 'web', group: 'top', demoteTo: 'web', title: 'Search the web', icon: Search, score: 100, primary: NOOP },
      { id: 'cap', group: 'top', title: 'Create note', icon: Search, score: 1800, primary: NOOP },
      { id: 'other', group: 'top', title: 'Other', icon: Search, score: 50, primary: NOOP },
      result('x', 'pages', 'Page', q, { score: 5 }),
    ];
    const view = runOmnibox('x', ctx(), [p], emptyUsage());
    expect(view.sections.map((s) => [s.id, s.results.map((r) => r.id)])).toEqual([
      ['top', ['cap']],
      ['pages', ['x']],
      ['web', ['web']],
    ]);
  });

  it('drops zero scores, survives a throwing provider and de-duplicates ids', () => {
    const boom: Provider = () => {
      throw new Error('boom');
    };
    const dup: Provider = (q) => [
      result('x', 'pages', 'Kanban', q, { score: 10 }),
      result('x', 'pages', 'Kanban', q, { score: 500 }),
      result('y', 'pages', 'Nope', 'zzz'),
    ];
    const view = runOmnibox('kan', ctx(), [boom, dup], emptyUsage());
    expect(view.results.map((r) => r.id)).toEqual(['x']);
    expect(view.results[0]?.score).toBe(500);
  });

  it('boosts what you pick, but not past a better match', () => {
    const p: Provider = (q) => [result('a', 'pages', 'Notes', q), result('b', 'pages', 'Notes archive', q)];
    expect(runOmnibox('notes', ctx(), [p], emptyUsage()).results.map((r) => r.id)).toEqual(['a', 'b']);
    let usage = emptyUsage();
    for (let i = 0; i < 6; i++) usage = recordUsage(usage, 'b', Date.parse('2026-11-16'));
    // "Notes" is an exact match (1000) vs a prefix match (~900): the habit lifts b but cannot overtake a
    expect(runOmnibox('notes', ctx(), [p], usage).results.map((r) => r.id)).toEqual(['a', 'b']);
    const weak: Provider = (q) => [result('a', 'pages', 'Notes app', q), result('b', 'pages', 'Keynotes list', q)];
    const base = runOmnibox('notes', ctx(), [weak], emptyUsage()).results.map((r) => r.id);
    expect(base).toEqual(['a', 'b']);
    expect(runOmnibox('notes', ctx(), [weak], usage).results.map((r) => r.id)).toEqual(['a', 'b']);
    const tie: Provider = (q) => [result('a', 'pages', 'Notes one', q), result('b', 'pages', 'Notes two', q)];
    expect(runOmnibox('notes', ctx(), [tie], usage).results[0]?.id).toBe('b');
  });

  it('never boosts results that opt out of frecency', () => {
    const p: Provider = (q) => [result('a', 'pages', 'Alpha', q, { frecencyKey: null }), result('b', 'pages', 'Alpha two', q)];
    let usage = emptyUsage();
    usage = recordUsage(usage, 'a');
    expect(runOmnibox('alpha', ctx(), [p], usage).results[0]?.id).toBe('a');
  });

  describe('with an empty box', () => {
    const browse: Provider = () => [
      { id: 'pg:notes', group: 'pages', title: 'Notes', icon: Search, score: 1, primary: NOOP },
      { id: 'pg:kanban', group: 'pages', title: 'Kanban', icon: Search, score: 1, primary: NOOP },
      { id: 'act:theme', group: 'actions', title: 'Toggle theme', icon: Search, score: 1, primary: NOOP },
      { id: 'tip', group: 'suggestions', title: 'Try it', icon: Search, score: 1, primary: NOOP },
    ];

    it('shows suggestions, pages and actions in browsing order', () => {
      const v = runOmnibox('', ctx(), [browse], emptyUsage());
      expect(v.sections.map((s) => s.id)).toEqual(['suggestions', 'pages', 'actions']);
      expect(v.ghost).toBeNull();
    });

    it('promotes pinned and (on the palette) recently used results, most recent first', () => {
      let usage = recordUsage(emptyUsage(), 'pg:kanban', 1000);
      usage = recordUsage(usage, 'act:theme', 2000);
      usage = togglePinned(usage, 'pg:notes');
      const v = runOmnibox('', ctx(), [browse], usage, { recentFromUsage: true });
      expect(v.sections.map((s) => s.id)).toEqual(['pinned', 'recent', 'suggestions']);
      expect(v.sections[0]?.results.map((r) => r.title)).toEqual(['Notes']);
      expect(v.sections[1]?.results.map((r) => r.title)).toEqual(['Toggle theme', 'Kanban']);
      expect(v.results.map((r) => r.id)).toEqual(['pinned:pg:notes', 'recent:act:theme', 'recent:pg:kanban', 'tip']);
      // promoted copies keep the original frecency key, so "remove from recent" / "unpin" act on the real thing
      expect(v.results[1]?.frecencyKey).toBe('act:theme');
    });

    it('leaves recents out when the surface asks for history instead', () => {
      const usage = recordUsage(emptyUsage(), 'pg:kanban', 1000);
      expect(runOmnibox('', ctx(), [browse], usage).sections.map((s) => s.id)).toEqual(['suggestions', 'pages', 'actions']);
    });
  });

  it('attaches section header actions', () => {
    const clear = { label: 'Clear', run: vi.fn() };
    const v = runOmnibox('', ctx(), [item('recent', 'foo')], emptyUsage(), { sectionActions: { recent: clear } });
    expect(v.sections[0]?.headerAction).toBe(clear);
  });
});

describe('ghost completion', () => {
  const rs = (text: string, over: Partial<OmniResult> = {}) => result(`r:${text}`, 'pages', text, text, { completion: { text }, ...over });

  it('offers the best-scoring result that extends what was typed', () => {
    expect(ghostFor('not', [rs('Notes', { score: 900 }), rs('Notifications', { score: 800 })])).toMatchObject({ text: 'Notes' });
    expect(ghostFor('NOT', [rs('Notes')])?.text).toBe('Notes'); // case-insensitive, keeps the title's casing
  });

  it('stays quiet when it would be noise', () => {
    expect(ghostFor('n', [rs('Notes')])).toBeNull(); // needs two characters
    expect(ghostFor('notes', [rs('Notes')])).toBeNull(); // already complete
    expect(ghostFor('not ', [rs('Notes')])).toBeNull(); // trailing space = moving on
    expect(ghostFor('xyz', [rs('Notes')])).toBeNull();
    expect(ghostFor('not', [result('a', 'pages', 'Notes', 'not')])).toBeNull(); // no completion offered
  });

  it('a bang ghost carries its scope so Tab can make a chip', () => {
    const bang = result('bang:yt', 'web', 'Search YouTube', 'yout', { completion: { text: 'youtube', scope: 'youtube' } });
    expect(ghostFor('yout', [bang])).toEqual({ text: 'youtube', resultId: 'bang:yt', scope: 'youtube' });
  });

  it('runOmnibox computes it from the displayed results', () => {
    const p: Provider = (q) => [result('n', 'pages', 'Notes', q, { completion: { text: 'Notes' } })];
    expect(runOmnibox('no', ctx(), [p], emptyUsage()).ghost?.text).toBe('Notes');
  });
});

describe('registerProvider', () => {
  it('adds and removes providers', () => {
    const p: Provider = () => [];
    const before = registeredProviders().length;
    const off = registerProvider('test-provider', p);
    expect(registeredProviders()).toContain(p);
    off();
    expect(registeredProviders()).toHaveLength(before);
  });

  it('replacing a provider and then calling the old remover keeps the new one', () => {
    const a: Provider = () => [];
    const b: Provider = () => [];
    const offA = registerProvider('swap', a);
    const offB = registerProvider('swap', b);
    offA();
    expect(registeredProviders()).toContain(b);
    offB();
  });
});

describe('scoreFields', () => {
  it('highlights the title only', () => {
    expect(scoreFields('kan', 'Kanban', ['boards']).matches).toEqual([0, 1, 2]);
    expect(scoreFields('boards', 'Kanban', ['boards']).matches).toEqual([]);
    expect(scoreFields('boards', 'Kanban', ['boards']).score).toBeGreaterThan(0);
  });
});
