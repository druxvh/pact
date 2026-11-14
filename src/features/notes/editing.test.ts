import { describe, expect, it } from 'vitest';
import { continueList, prefixLine, toggleTaskOnLine, wrapSelection } from '@/features/notes/editing';

describe('toggleTaskOnLine', () => {
  const doc = '## List\n- [ ] one\n- [x] two\nplain line\n1. [ ] numbered';
  it('checks and unchecks the right line', () => {
    expect(toggleTaskOnLine(doc, 2)).toContain('- [x] one');
    expect(toggleTaskOnLine(doc, 3)).toContain('- [ ] two');
    expect(toggleTaskOnLine(doc, 5)).toContain('1. [x] numbered');
  });
  it('leaves non-task lines and out-of-range lines alone', () => {
    expect(toggleTaskOnLine(doc, 4)).toBe(doc);
    expect(toggleTaskOnLine(doc, 99)).toBe(doc);
  });
  it('only changes the targeted line', () => {
    const next = toggleTaskOnLine(doc, 2).split('\n');
    expect(next.filter((l, i) => l !== doc.split('\n')[i])).toHaveLength(1);
  });
});

describe('wrapSelection', () => {
  it('wraps and then unwraps (toggle)', () => {
    const a = wrapSelection('hello world', 6, 11, '**');
    expect(a.value).toBe('hello **world**');
    expect([a.selectionStart, a.selectionEnd]).toEqual([8, 13]);
    const b = wrapSelection(a.value, a.selectionStart, a.selectionEnd, '**');
    expect(b.value).toBe('hello world');
  });
  it('inserts a pair around an empty selection', () => {
    const r = wrapSelection('ab', 1, 1, '`');
    expect(r.value).toBe('a``b');
    expect(r.selectionStart).toBe(2);
  });
});

describe('prefixLine', () => {
  it('prefixes the current line and toggles it off', () => {
    const a = prefixLine('one\ntwo', 5, 5, '## ');
    expect(a.value).toBe('one\n## two');
    expect(prefixLine(a.value, a.selectionStart, a.selectionEnd, '## ').value).toBe('one\ntwo');
  });
});

describe('continueList', () => {
  it('continues bullets', () => {
    const v = '- one';
    const r = continueList(v, v.length);
    expect(r?.value).toBe('- one\n- ');
    expect(r?.selectionStart).toBe(r?.value.length);
  });
  it('increments numbered lists', () => {
    expect(continueList('1. a', 4)?.value).toBe('1. a\n2. ');
    expect(continueList('9) a', 4)?.value).toBe('9) a\n10) ');
  });
  it('starts the next task unchecked', () => {
    expect(continueList('- [x] done', 10)?.value).toBe('- [x] done\n- [ ] ');
  });
  it('keeps indentation for nested items', () => {
    expect(continueList('  - nested', 10)?.value).toBe('  - nested\n  - ');
  });
  it('exits the list on an empty item', () => {
    const r = continueList('- one\n- ', 8);
    expect(r?.value).toBe('- one\n');
  });
  it('does nothing outside a list', () => {
    expect(continueList('just text', 9)).toBeNull();
  });
});
