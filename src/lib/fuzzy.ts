const SEPARATOR = /[\s\-_/.:@#]/;

/** A fuzzy score plus the character positions of `text` that matched (for highlighting). */
export type FuzzyMatch = { score: number; indices: number[] };

const NO_MATCH: FuzzyMatch = { score: 0, indices: [] };
const range = (from: number, length: number): number[] => Array.from({ length }, (_, i) => from + i);

/**
 * The single-needle matcher both public entry points share. `q` must already be trimmed + lower-cased.
 * `strict` (used by `fuzzyMatch`) additionally requires a scattered match to *start* at the beginning of a word, so
 * "kan" no longer finds "Mar**k** **a**ll **n**otifications" — the kind of hit that looks like a bug in a result list.
 */
function scan(q: string, text: string, strict = false): FuzzyMatch {
  const t = text.toLowerCase();
  if (t === q) return { score: 1000, indices: range(0, q.length) };
  if (t.startsWith(q)) return { score: 900 - Math.min(t.length, 100) * 0.1, indices: range(0, q.length) };

  const idx = t.indexOf(q);
  if (idx >= 0) {
    const boundary = idx === 0 || SEPARATOR.test(t[idx - 1] ?? '');
    return { score: (boundary ? 800 : 600) - idx * 0.5, indices: range(idx, q.length) };
  }

  // every query char must appear in order — but only count it when the matched
  // characters are close together, otherwise short queries match almost anything
  let ti = 0;
  let qi = 0;
  let gaps = 0;
  let first = -1;
  let last = -1;
  const indices: number[] = [];
  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      if (first < 0) first = ti;
      if (last >= 0 && ti - last > 1) gaps++;
      last = ti;
      indices.push(ti);
      qi++;
    }
    ti++;
  }
  if (qi < q.length) return NO_MATCH;
  if (last - first + 1 > q.length * 3) return NO_MATCH;
  if (strict && first > 0 && !SEPARATOR.test(t[first - 1] ?? '')) return NO_MATCH;
  return { score: Math.max(10, 300 - gaps * 25 - first), indices };
}

/**
 * Lightweight fuzzy score. 0 = no match; higher = better.
 *   exact > prefix > word-start substring > substring > in-order subsequence
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  return scan(q, text).score;
}

/**
 * Like {@link fuzzyScore}, but also reports *which* characters matched so a UI can highlight them. Multi-word
 * queries additionally match their words in any order ("notes go" finds "Go to Notes"), scored a little lower than
 * a contiguous match.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 1, indices: [] };
  const whole = scan(q, text, true);
  if (whole.score > 0 || !/\s/.test(q)) return whole;

  const words = q.split(/\s+/).filter(Boolean);
  const hit = new Set<number>();
  let min = Number.POSITIVE_INFINITY;
  for (const w of words) {
    const m = scan(w, text, true);
    if (m.score <= 0) return NO_MATCH;
    min = Math.min(min, m.score);
    for (const i of m.indices) hit.add(i);
  }
  return { score: min * 0.85, indices: [...hit].sort((a, b) => a - b) };
}

/** Best score across several fields; later fields are weighted down. */
export function bestScore(query: string, fields: Array<string | undefined>): number {
  let best = 0;
  fields.forEach((f, i) => {
    if (!f) return;
    best = Math.max(best, fuzzyScore(query, f) * (i === 0 ? 1 : 0.7));
  });
  return best;
}

/**
 * Best match across several fields (the first one is the title: later fields are weighted down). `indices` are
 * positions in the **first** field only — a hit in a keyword shouldn't light up unrelated letters of the title.
 */
export function bestMatch(query: string, fields: Array<string | undefined>): FuzzyMatch {
  let best = 0;
  let titleIndices: number[] = [];
  fields.forEach((f, i) => {
    if (!f) return;
    const m = fuzzyMatch(query, f);
    best = Math.max(best, m.score * (i === 0 ? 1 : 0.7));
    if (i === 0) titleIndices = m.indices;
  });
  return { score: best, indices: titleIndices };
}

/** Collapse sorted indices into [start, end) runs: [0,1,2,5] → [[0,3],[5,6]]. */
export function toRuns(indices: readonly number[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (const i of indices) {
    const last = runs[runs.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else runs.push([i, i + 1]);
  }
  return runs;
}
