/** Text transformation + analysis helpers. Pure. */

/** Split into words for case conversion: handles spaces, -, _, camelCase boundaries and digits. */
function words(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w);

export const CASES = {
  upper: (s: string) => s.toUpperCase(),
  lower: (s: string) => s.toLowerCase(),
  title: (s: string) => s.toLowerCase().replace(/(^|[\s\-–—(["'])(\p{L})/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase()),
  sentence: (s: string) => s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase()),
  camel: (s: string) =>
    words(s)
      .map((w, i) => (i === 0 ? w.toLowerCase() : cap(w)))
      .join(''),
  pascal: (s: string) => words(s).map(cap).join(''),
  snake: (s: string) =>
    words(s)
      .map((w) => w.toLowerCase())
      .join('_'),
  kebab: (s: string) =>
    words(s)
      .map((w) => w.toLowerCase())
      .join('-'),
  constant: (s: string) =>
    words(s)
      .map((w) => w.toUpperCase())
      .join('_'),
  slug: (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, ''),
} as const;
export type CaseKind = keyof typeof CASES;

/** Grapheme-aware reverse (the old `split('')` tore emoji and combining marks apart). */
export function reverseText(s: string): string {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (!Seg) return Array.from(s).reverse().join('');
  return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment)
    .reverse()
    .join('');
}

export const LINES = {
  sort: (s: string) =>
    s
      .split('\n')
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      .join('\n'),
  reverse: (s: string) => s.split('\n').reverse().join('\n'),
  unique: (s: string) => [...new Set(s.split('\n'))].join('\n'),
  dropEmpty: (s: string) =>
    s
      .split('\n')
      .filter((l) => l.trim() !== '')
      .join('\n'),
  trim: (s: string) =>
    s
      .split('\n')
      .map((l) => l.trim())
      .join('\n'),
} as const;
export type LineKind = keyof typeof LINES;

export type TextStats = { chars: number; charsNoSpaces: number; words: number; lines: number; sentences: number; readingMinutes: number };

export function textStats(s: string): TextStats {
  const trimmed = s.trim();
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;
  return {
    chars: Array.from(s).length,
    charsNoSpaces: Array.from(s.replace(/\s/g, '')).length,
    words: wordCount,
    lines: s ? s.split('\n').length : 0,
    sentences: trimmed ? (trimmed.match(/[^.!?]+[.!?]+(\s|$)/g)?.length ?? 1) : 0,
    readingMinutes: wordCount / 230,
  };
}
