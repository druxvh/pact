/**
 * Photo/video filters.
 *
 * A filter is a short list of CSS filter functions. That one description drives three things so they always agree:
 *  - the live preview (`style.filter` on the <video>),
 *  - the saved picture/clip (`ctx.filter` on the canvas the frame is drawn into),
 *  - a pixel-math fallback for browsers whose canvas has no `ctx.filter` — it implements the colour matrices from the CSS
 *    Filter Effects spec, so the fallback matches what the preview showed.
 */
export type FilterFn = 'grayscale' | 'sepia' | 'saturate' | 'contrast' | 'brightness' | 'hue-rotate';
export type FilterOp = { fn: FilterFn; value: number };

export type FilterId = 'none' | 'mono' | 'noir' | 'warm' | 'cool' | 'vivid' | 'fade' | 'sepia';

export type FilterDef = { id: FilterId; label: string; ops: readonly FilterOp[] };

const op = (fn: FilterFn, value: number): FilterOp => ({ fn, value });

/** In keyboard order: the number keys 1–8 pick these. */
export const FILTERS: readonly FilterDef[] = [
  { id: 'none', label: 'None', ops: [] },
  { id: 'mono', label: 'Mono', ops: [op('grayscale', 1), op('contrast', 1.08)] },
  { id: 'noir', label: 'Noir', ops: [op('grayscale', 1), op('contrast', 1.45), op('brightness', 0.9)] },
  { id: 'warm', label: 'Warm', ops: [op('sepia', 0.28), op('saturate', 1.25), op('brightness', 1.04)] },
  // Sepia is warm; turning the colours half-way round the wheel before and after it leaves the picture as it was but tints it cool.
  { id: 'cool', label: 'Cool', ops: [op('hue-rotate', 180), op('sepia', 0.32), op('hue-rotate', 180), op('saturate', 1.08), op('brightness', 1.02)] },
  { id: 'vivid', label: 'Vivid', ops: [op('saturate', 1.55), op('contrast', 1.14), op('brightness', 1.03)] },
  { id: 'fade', label: 'Fade', ops: [op('contrast', 0.86), op('brightness', 1.1), op('saturate', 0.78), op('sepia', 0.1)] },
  { id: 'sepia', label: 'Sepia', ops: [op('sepia', 0.85), op('contrast', 1.05), op('brightness', 1.02)] },
];

export const FILTER_IDS: readonly FilterId[] = FILTERS.map((f) => f.id);
export const isFilterId = (v: unknown): v is FilterId => typeof v === 'string' && (FILTER_IDS as readonly string[]).includes(v);
export const filterById = (id: FilterId): FilterDef => FILTERS.find((f) => f.id === id) ?? (FILTERS[0] as FilterDef);

/** Quick brightness/contrast sliders: a percentage, 100 = unchanged. */
export const ADJUST_MIN = 50;
export const ADJUST_MAX = 150;
export type Adjust = { brightness: number; contrast: number };
export const NEUTRAL_ADJUST: Adjust = { brightness: 100, contrast: 100 };
export const isNeutralAdjust = (a: Adjust): boolean => a.brightness === 100 && a.contrast === 100;

const clampPct = (v: number) => Math.min(ADJUST_MAX, Math.max(ADJUST_MIN, Number.isFinite(v) ? v : 100));

/** Everything to apply, in order: the chosen filter, then the sliders. */
export function opsFor(filter: FilterId, adjust: Adjust = NEUTRAL_ADJUST): FilterOp[] {
  const ops = [...filterById(filter).ops];
  const b = clampPct(adjust.brightness);
  const c = clampPct(adjust.contrast);
  if (b !== 100) ops.push(op('brightness', b / 100));
  if (c !== 100) ops.push(op('contrast', c / 100));
  return ops;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** The CSS `filter` / canvas `ctx.filter` string for a list of ops (`'none'` when empty). */
export function toCss(ops: readonly FilterOp[]): string {
  if (ops.length === 0) return 'none';
  return ops.map((o) => (o.fn === 'hue-rotate' ? `hue-rotate(${round(o.value)}deg)` : `${o.fn}(${round(o.value)})`)).join(' ');
}

// ── pixel fallback ───────────────────────────────────────────────────────────

type Matrix = readonly [number, number, number, number, number, number, number, number, number];

/** The colour matrices of the CSS Filter Effects spec (row-major, applied to [r g b]). */
function matrixFor(o: FilterOp): Matrix | null {
  switch (o.fn) {
    case 'grayscale': {
      const a = 1 - Math.min(1, Math.max(0, o.value));
      return [
        0.2126 + 0.7874 * a,
        0.7152 - 0.7152 * a,
        0.0722 - 0.0722 * a,
        0.2126 - 0.2126 * a,
        0.7152 + 0.2848 * a,
        0.0722 - 0.0722 * a,
        0.2126 - 0.2126 * a,
        0.7152 - 0.7152 * a,
        0.0722 + 0.9278 * a,
      ];
    }
    case 'sepia': {
      const a = 1 - Math.min(1, Math.max(0, o.value));
      return [
        0.393 + 0.607 * a,
        0.769 - 0.769 * a,
        0.189 - 0.189 * a,
        0.349 - 0.349 * a,
        0.686 + 0.314 * a,
        0.168 - 0.168 * a,
        0.272 - 0.272 * a,
        0.534 - 0.534 * a,
        0.131 + 0.869 * a,
      ];
    }
    case 'saturate': {
      const s = Math.max(0, o.value);
      return [
        0.213 + 0.787 * s,
        0.715 - 0.715 * s,
        0.072 - 0.072 * s,
        0.213 - 0.213 * s,
        0.715 + 0.285 * s,
        0.072 - 0.072 * s,
        0.213 - 0.213 * s,
        0.715 - 0.715 * s,
        0.072 + 0.928 * s,
      ];
    }
    case 'hue-rotate': {
      const r = (o.value * Math.PI) / 180;
      const c = Math.cos(r);
      const s = Math.sin(r);
      return [
        0.213 + c * 0.787 - s * 0.213,
        0.715 - c * 0.715 - s * 0.715,
        0.072 - c * 0.072 + s * 0.928,
        0.213 - c * 0.213 + s * 0.143,
        0.715 + c * 0.285 + s * 0.14,
        0.072 - c * 0.072 - s * 0.283,
        0.213 - c * 0.213 - s * 0.787,
        0.715 - c * 0.715 + s * 0.715,
        0.072 + c * 0.928 + s * 0.072,
      ];
    }
    default:
      return null;
  }
}

const clamp255 = (v: number) => Math.min(255, Math.max(0, v));

/** Apply the ops to RGBA pixels in place (alpha untouched). This is the slow path; it only runs when `ctx.filter` is missing. */
export function applyPixelFilter(data: Uint8ClampedArray | Uint8Array, ops: readonly FilterOp[]): void {
  if (ops.length === 0) return;
  const steps = ops.map((o) => ({ o, m: matrixFor(o) }));
  for (let i = 0; i + 3 < data.length; i += 4) {
    let r = data[i] as number;
    let g = data[i + 1] as number;
    let b = data[i + 2] as number;
    for (const { o, m } of steps) {
      if (m) {
        const nr = m[0] * r + m[1] * g + m[2] * b;
        const ng = m[3] * r + m[4] * g + m[5] * b;
        const nb = m[6] * r + m[7] * g + m[8] * b;
        r = clamp255(nr);
        g = clamp255(ng);
        b = clamp255(nb);
      } else if (o.fn === 'brightness') {
        r = clamp255(r * o.value);
        g = clamp255(g * o.value);
        b = clamp255(b * o.value);
      } else if (o.fn === 'contrast') {
        const k = 127.5 * (1 - o.value);
        r = clamp255(r * o.value + k);
        g = clamp255(g * o.value + k);
        b = clamp255(b * o.value + k);
      }
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

/** Does this canvas context honour `ctx.filter`? (Chromium does; some browsers accept the assignment and ignore it.) */
export function supportsCtxFilter(ctx: { filter?: string } | null | undefined): boolean {
  if (!ctx || !('filter' in ctx)) return false;
  try {
    ctx.filter = 'grayscale(1)';
    const ok = ctx.filter === 'grayscale(1)';
    ctx.filter = 'none';
    return ok;
  } catch {
    return false;
  }
}
