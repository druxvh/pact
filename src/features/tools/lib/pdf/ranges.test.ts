import { describe, expect, it } from 'vitest';
import { describeRange, MAX_OUTPUTS, outputNames, pagesInRanges, parseRanges, planSplit, summarize } from './ranges';

const ok = (input: string, total: number) => {
  const r = parseRanges(input, total);
  if (!r.ok) throw new Error(r.error);
  return r.ranges;
};
const error = (input: string, total: number) => {
  const r = parseRanges(input, total);
  if (r.ok) throw new Error(`expected an error for “${input}”`);
  return r.error;
};

describe('parseRanges', () => {
  it('reads singles, ranges and open-ended ranges, in the order typed', () => {
    expect(ok('1-3, 5, 8-', 12)).toEqual([
      { from: 1, to: 3 },
      { from: 5, to: 5 },
      { from: 8, to: 12 },
    ]);
  });
  it('reads a leading open end as "from the first page"', () => {
    expect(ok('-3', 10)).toEqual([{ from: 1, to: 3 }]);
    expect(ok('-3, 9-', 10)).toEqual([
      { from: 1, to: 3 },
      { from: 9, to: 10 },
    ]);
  });
  it('is relaxed about spacing and separators', () => {
    const want = [
      { from: 1, to: 3 },
      { from: 5, to: 5 },
    ];
    for (const text of ['1-3,5', ' 1 - 3 , 5 ', '1-3; 5', '1-3 5', '1–3, 5', '1—3,5', '1−3,5', '1‐3,5']) expect(ok(text, 9)).toEqual(want);
  });
  it('keeps overlapping and repeated ranges as separate items', () => {
    expect(ok('1-5, 3-7, 1-5', 9)).toHaveLength(3);
  });
  it('accepts the whole document and a single-page document', () => {
    expect(ok('1-', 4)).toEqual([{ from: 1, to: 4 }]);
    expect(ok('1', 1)).toEqual([{ from: 1, to: 1 }]);
  });
  it('explains what is wrong', () => {
    expect(error('', 5)).toContain('Type the pages');
    expect(error('   ', 5)).toContain('Type the pages');
    expect(error('0', 5)).toBe('Pages start at 1.');
    expect(error('0-3', 5)).toBe('Pages start at 1.');
    expect(error('7', 5)).toBe('Page 7 doesn’t exist — this PDF has 5 pages.');
    expect(error('2-9', 5)).toContain('Page 9 doesn’t exist');
    expect(error('8-', 5)).toContain('Page 8 doesn’t exist');
    expect(error('5', 1)).toBe('Page 5 doesn’t exist — this PDF has 1 page.');
    expect(error('5-3', 9)).toBe('“5-3” goes backwards. Write it as 3-5.');
    expect(error('abc', 9)).toContain('Couldn’t read “abc”');
    expect(error('1-2-3', 9)).toContain('Couldn’t read');
    expect(error('-', 9)).toContain('Couldn’t read');
    expect(error('1.5', 9)).toContain('Couldn’t read');
    expect(error('1, ,x', 9)).toContain('Couldn’t read “x”');
    expect(error('123456789', 9)).toContain('Couldn’t read');
  });
  it('reports the first problem in a list', () => {
    expect(error('1-2, 99, abc', 9)).toContain('Page 99');
  });
});

describe('pagesInRanges / summarize', () => {
  it('lists the covered pages once, sorted, 0-based', () => {
    expect(
      pagesInRanges([
        { from: 5, to: 6 },
        { from: 1, to: 2 },
        { from: 2, to: 5 },
      ]),
    ).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('counts files, pages written and pages of the original used', () => {
    const groups = [
      { from: 1, to: 3 },
      { from: 3, to: 4 },
    ];
    expect(summarize(groups, 10)).toEqual({ files: 2, pagesOut: 5, pagesUsed: 4, unused: 6 });
  });
});

describe('planSplit', () => {
  const settings = { ranges: '', every: 2 };
  it('by range: one file per item', () => {
    const plan = planSplit('ranges', 12, { ...settings, ranges: '1-3, 5, 8-' });
    expect(plan).toEqual({
      ok: true,
      groups: [
        { from: 1, to: 3 },
        { from: 5, to: 5 },
        { from: 8, to: 12 },
      ],
    });
    expect(planSplit('ranges', 12, { ...settings, ranges: '13' })).toMatchObject({ ok: false });
  });
  it('every N pages: even groups with a shorter last one', () => {
    expect(planSplit('every', 7, { ...settings, every: 3 })).toEqual({
      ok: true,
      groups: [
        { from: 1, to: 3 },
        { from: 4, to: 6 },
        { from: 7, to: 7 },
      ],
    });
    expect(planSplit('every', 6, { ...settings, every: 2 })).toMatchObject({
      ok: true,
      groups: [
        { from: 1, to: 2 },
        { from: 3, to: 4 },
        { from: 5, to: 6 },
      ],
    });
  });
  it('every N pages: rejects nonsense and groups that would keep everything together', () => {
    for (const every of [0, -2, 1.5, Number.NaN]) expect(planSplit('every', 10, { ...settings, every })).toMatchObject({ ok: false });
    expect(planSplit('every', 10, { ...settings, every: 10 })).toMatchObject({ ok: false });
    expect(planSplit('every', 10, { ...settings, every: 99 })).toMatchObject({ ok: false });
    expect(planSplit('every', 10, { ...settings, every: 9 })).toMatchObject({ ok: true });
  });
  it('one file per page', () => {
    expect(planSplit('each', 3, settings)).toEqual({
      ok: true,
      groups: [
        { from: 1, to: 1 },
        { from: 2, to: 2 },
        { from: 3, to: 3 },
      ],
    });
    expect(planSplit('each', 1, settings)).toMatchObject({ ok: false });
  });
  it('refuses to make an absurd number of files', () => {
    const plan = planSplit('each', MAX_OUTPUTS + 1, settings);
    expect(plan).toMatchObject({ ok: false });
    expect(planSplit('each', MAX_OUTPUTS, settings)).toMatchObject({ ok: true });
  });
});

describe('names', () => {
  it('describes ranges for people', () => {
    expect(describeRange({ from: 5, to: 5 })).toBe('page 5');
    expect(describeRange({ from: 1, to: 3 })).toBe('pages 1–3');
  });
  it('pads page numbers to the document’s width so files sort', () => {
    expect(
      outputNames(
        'report',
        [
          { from: 1, to: 3 },
          { from: 5, to: 5 },
          { from: 10, to: 120 },
        ],
        120,
      ),
    ).toEqual(['report-pages-001-003.pdf', 'report-page-005.pdf', 'report-pages-010-120.pdf']);
  });
  it('keeps names unique when a range repeats', () => {
    expect(
      outputNames(
        'a',
        [
          { from: 1, to: 2 },
          { from: 1, to: 2 },
          { from: 1, to: 2 },
        ],
        9,
      ),
    ).toEqual(['a-pages-1-2.pdf', 'a-pages-1-2-2.pdf', 'a-pages-1-2-3.pdf']);
  });
});
