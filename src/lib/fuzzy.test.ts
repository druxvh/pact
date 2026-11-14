import { describe, expect, it } from 'vitest';
import { bestScore, fuzzyScore } from '@/lib/fuzzy';

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
