/**
 * Page ranges as people type them (`1-3, 5, 8-`) and the plans built on them: split by range, every N pages, one file per
 * page. Pure functions — the Split and Watermark tools validate live with them, and the same result drives the worker.
 */

/** Pages `from`–`to`, 1-based and inclusive. */
export type PageRange = { from: number; to: number };

export type ParsedRanges = { ok: true; ranges: PageRange[] } | { ok: false; error: string };

export const RANGE_EXAMPLE = '1-3, 5, 8-';
/** Splitting into more files than this is almost certainly a mistake (and a zip of thousands of files isn't useful). */
export const MAX_OUTPUTS = 1000;

const SINGLE = /^\d{1,7}$/;
const SPAN = /^(\d{1,7})?-(\d{1,7})?$/;

/**
 * Parse text like `1-3, 5, 8-` against a document of `total` pages.
 *
 * - `5` is one page, `2-4` an inclusive range, `8-` runs to the last page and `-3` from the first.
 * - Items are separated by commas, semicolons or spaces; en/em dashes are accepted (people paste them).
 * - Every item is kept as written (`1-5, 3-7` overlap on purpose), in the order typed.
 */
export function parseRanges(input: string, total: number): ParsedRanges {
  const text = input
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .trim();
  if (!text) return { ok: false, error: `Type the pages you want, like ${RANGE_EXAMPLE}.` };

  const ranges: PageRange[] = [];
  for (const item of text.split(/[\s,;]+/).filter(Boolean)) {
    // The valid shapes are "5", "2-4", "8-" and "-3". Anything else ("-", "1-2-3", "x", a 9-digit number) is a typo.
    const span = SINGLE.test(item) ? null : SPAN.exec(item);
    if (!SINGLE.test(item) && (!span || (!span[1] && !span[2])))
      return { ok: false, error: `Couldn’t read “${item}”. Use page numbers and ranges, like ${RANGE_EXAMPLE}.` };
    const first = span ? (span[1] ? Number(span[1]) : 1) : Number(item);
    const last = span ? (span[2] ? Number(span[2]) : total) : first;
    if (first < 1 || last < 1) return { ok: false, error: 'Pages start at 1.' };
    const worst = Math.max(first, last);
    if (worst > total) return { ok: false, error: `Page ${worst} doesn’t exist — this PDF has ${total} ${total === 1 ? 'page' : 'pages'}.` };
    if (first > last) return { ok: false, error: `“${item}” goes backwards. Write it as ${last}-${first}.` };
    ranges.push({ from: first, to: last });
  }
  return ranges.length ? { ok: true, ranges } : { ok: false, error: `Type the pages you want, like ${RANGE_EXAMPLE}.` };
}

/** Every page covered by at least one range, as sorted 0-based indices. */
export function pagesInRanges(ranges: readonly PageRange[]): number[] {
  const seen = new Set<number>();
  for (const r of ranges) for (let p = r.from; p <= r.to; p++) seen.add(p - 1);
  return [...seen].sort((a, b) => a - b);
}

export type SplitMode = 'ranges' | 'every' | 'each';

export type SplitPlan = { ok: true; groups: PageRange[] } | { ok: false; error: string };

/** Turn a mode + its settings into the list of output files (each a page range). */
export function planSplit(mode: SplitMode, total: number, settings: { ranges: string; every: number }): SplitPlan {
  let groups: PageRange[];
  if (mode === 'ranges') {
    const parsed = parseRanges(settings.ranges, total);
    if (!parsed.ok) return parsed;
    groups = parsed.ranges;
  } else if (mode === 'every') {
    const n = settings.every;
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'Enter a whole number of pages, 1 or more.' };
    if (n >= total)
      return { ok: false, error: `${n} pages or more per file would keep everything in one file — this PDF has ${total} ${total === 1 ? 'page' : 'pages'}.` };
    groups = [];
    for (let from = 1; from <= total; from += n) groups.push({ from, to: Math.min(total, from + n - 1) });
  } else {
    if (total < 2) return { ok: false, error: 'This PDF has only one page, so there is nothing to split.' };
    groups = Array.from({ length: total }, (_, i) => ({ from: i + 1, to: i + 1 }));
  }
  if (groups.length > MAX_OUTPUTS) return { ok: false, error: `That would make ${groups.length} files — the limit is ${MAX_OUTPUTS}. Use larger groups.` };
  return { ok: true, groups };
}

/** "pages 1–3", "page 5", "pages 8–12" — for people. */
export function describeRange(r: PageRange): string {
  return r.from === r.to ? `page ${r.from}` : `pages ${r.from}–${r.to}`;
}

export function pageCountOf(r: PageRange): number {
  return r.to - r.from + 1;
}

/** A readable summary of a plan: how many files, how many pages go out, and how many of the document's pages are used. */
export function summarize(groups: readonly PageRange[], total: number): { files: number; pagesOut: number; pagesUsed: number; unused: number } {
  const pagesOut = groups.reduce((n, g) => n + pageCountOf(g), 0);
  const pagesUsed = pagesInRanges(groups).length;
  return { files: groups.length, pagesOut, pagesUsed, unused: total - pagesUsed };
}

/**
 * File names for each output: `<base>-pages-01-03.pdf`, `<base>-page-05.pdf`. Page numbers are zero-padded to the
 * width of the page count so they sort properly in a folder, and repeats (the same range twice) get `-2`, `-3`.
 */
export function outputNames(base: string, groups: readonly PageRange[], total: number): string[] {
  const width = String(total).length;
  const pad = (n: number) => String(n).padStart(width, '0');
  const used = new Set<string>();
  return groups.map((g) => {
    const stem = `${base}-${g.from === g.to ? `page-${pad(g.from)}` : `pages-${pad(g.from)}-${pad(g.to)}`}`;
    let name = `${stem}.pdf`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem}-${n}.pdf`;
    used.add(name.toLowerCase());
    return name;
  });
}
