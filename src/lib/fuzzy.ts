const SEPARATOR = /[\s\-_/.:@#]/;

/**
 * Lightweight fuzzy score. 0 = no match; higher = better.
 *   exact > prefix > word-start substring > substring > in-order subsequence
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = text.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 900 - Math.min(t.length, 100) * 0.1;

  const idx = t.indexOf(q);
  if (idx >= 0) {
    const boundary = idx === 0 || SEPARATOR.test(t[idx - 1] ?? '');
    return (boundary ? 800 : 600) - idx * 0.5;
  }

  // every query char must appear in order — but only count it when the matched
  // characters are close together, otherwise short queries match almost anything
  let ti = 0;
  let qi = 0;
  let gaps = 0;
  let first = -1;
  let last = -1;
  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      if (first < 0) first = ti;
      if (last >= 0 && ti - last > 1) gaps++;
      last = ti;
      qi++;
    }
    ti++;
  }
  if (qi < q.length) return 0;
  if (last - first + 1 > q.length * 3) return 0;
  return Math.max(10, 300 - gaps * 25 - first);
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
