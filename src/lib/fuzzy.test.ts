import { describe, expect, it } from 'vitest';
import { bestMatch, bestScore, fuzzyMatch, fuzzyScore, toRuns } from '@/lib/fuzzy';

describe('fuzzyScore', () => {
  it('ranks exact > prefix > word-start > substring', () => {
    const exact = fuzzyScore('notes', 'notes');
    const prefix = fuzzyScore('not', 'notes');
    const wordStart = fuzzyScore('not', 'my notes');
    const inner = fuzzyScore('ote', 'notes');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(inner);
    expect(inner).toBeGreaterThan(0);
  });

  it('matches tight in-order subsequences', () => {
    expect(fuzzyScore('kbn', 'Kanban')).toBeGreaterThan(0);
    expect(fuzzyScore('gtk', 'Go to Kanban')).toBeGreaterThan(0); // spans 7 chars, within the allowance
    expect(fuzzyScore('gk', 'Go to the Kanban board')).toBe(0); // spread across 11 chars → too loose
  });

  it('does not let short queries match unrelated long strings', () => {
    // "tim" used to match "Toggle light / dark theme" by scattering across the string
    expect(fuzzyScore('tim', 'Toggle light / dark theme')).toBe(0);
    expect(fuzzyScore('tim', 'Go to Focus timer')).toBeGreaterThan(0);
  });

  it('is case-insensitive and treats an empty query as a match', () => {
    expect(fuzzyScore('NOTES', 'my notes')).toBeGreaterThan(0);
    expect(fuzzyScore('', 'anything')).toBeGreaterThan(0);
    expect(fuzzyScore('zzz', 'notes')).toBe(0);
  });

  it('bestScore weights later fields lower', () => {
    expect(bestScore('timer', ['Timer', undefined, 'x'])).toBeGreaterThan(bestScore('timer', ['x', 'Timer']));
  });
});

describe('fuzzyMatch', () => {
  it('agrees with fuzzyScore', () => {
    for (const [q, t] of [
      ['notes', 'notes'],
      ['not', 'my notes'],
      ['kbn', 'Kanban'],
      ['gk', 'Go to the Kanban board'],
      ['zzz', 'notes'],
    ] as const) {
      expect(fuzzyMatch(q, t).score).toBe(fuzzyScore(q, t));
    }
  });

  it('only accepts a scattered match that starts at a word boundary', () => {
    expect(fuzzyScore('kan', 'Mark all notifications')).toBeGreaterThan(0); // the lenient scorer keeps its old behaviour…
    expect(fuzzyMatch('kan', 'Mark all notifications').score).toBe(0); // …the highlighter does not
    expect(fuzzyMatch('kbn', 'Kanban').indices).toEqual([0, 3, 5]);
    expect(fuzzyMatch('gtk', 'Go to Kanban').score).toBeGreaterThan(0);
    expect(fuzzyMatch('tk', 'Go to Kanban').score).toBeGreaterThan(0);
  });

  it('reports the matched positions for each kind of match', () => {
    expect(fuzzyMatch('not', 'Notes').indices).toEqual([0, 1, 2]); // prefix
    expect(fuzzyMatch('ote', 'Notes').indices).toEqual([1, 2, 3]); // substring
    expect(fuzzyMatch('kbn', 'Kanban').indices).toEqual([0, 3, 5]); // subsequence
    expect(fuzzyMatch('', 'x')).toEqual({ score: 1, indices: [] });
    expect(fuzzyMatch('zzz', 'notes')).toEqual({ score: 0, indices: [] });
  });

  it('matches the words of a multi-word query in any order', () => {
    const m = fuzzyMatch('notes go', 'Go to Notes');
    expect(m.score).toBeGreaterThan(0);
    expect(m.indices).toEqual([0, 1, 6, 7, 8, 9, 10]);
    expect(fuzzyMatch('notes zzz', 'Go to Notes').score).toBe(0);
    // a contiguous match still beats a reordered one
    expect(fuzzyMatch('go to', 'Go to Notes').score).toBeGreaterThan(m.score);
  });
});

describe('bestMatch', () => {
  it('highlights the title only, even when a keyword matched better', () => {
    const m = bestMatch('todo', ['Create a task', 'todo kanban add']);
    expect(m.score).toBeGreaterThan(0);
    expect(m.indices).toEqual([]);
    expect(bestMatch('tas', ['Create a task', 'x']).indices).toEqual([9, 10, 11]);
  });
});

describe('toRuns', () => {
  it('collapses consecutive indices', () => {
    expect(toRuns([0, 1, 2, 5, 7, 8])).toEqual([
      [0, 3],
      [5, 6],
      [7, 9],
    ]);
    expect(toRuns([])).toEqual([]);
  });
});
