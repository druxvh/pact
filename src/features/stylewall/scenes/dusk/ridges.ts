/**
 * Ridgeline generation for Dithered Dusk: pure functions of a seed, so the same seed always draws the same mountains.
 * A ridge is the height (y of its crest, in canvas pixels) of every column of a sprite that is a little wider than the canvas, so
 * the pointer parallax can slide it without ever showing an edge.
 */
import { fbm1 } from '../../noise';
import { clamp, lerp, mulberry32 } from '../../rng';

export type RidgeSpec = {
  /** Mean crest height as a fraction of the canvas height, from the top. */
  base: number;
  /** Peak-to-peak variation as a fraction of the canvas height. */
  amp: number;
  /** Noise cycles across the canvas width. */
  freq: number;
  /** 0 = rolling hills, 1 = sharp crests (the "ridged" noise transform). */
  ridged: number;
  octaves: number;
  /** Pixels of horizontal parallax per unit of pointer movement (−1…1). */
  parallax: number;
};

/** Far → near. Five layers: tall jagged far peaks softening into near rolling hills. */
export const RIDGES: readonly RidgeSpec[] = [
  { base: 0.665, amp: 0.1, freq: 2.4, ridged: 0.8, octaves: 5, parallax: 1.2 },
  { base: 0.715, amp: 0.1, freq: 3.1, ridged: 0.55, octaves: 5, parallax: 2.4 },
  { base: 0.775, amp: 0.09, freq: 3.8, ridged: 0.35, octaves: 5, parallax: 4.2 },
  { base: 0.845, amp: 0.08, freq: 4.8, ridged: 0.18, octaves: 4, parallax: 6.6 },
  { base: 0.935, amp: 0.055, freq: 6.5, ridged: 0, octaves: 4, parallax: 10 },
];

/** Extra columns on each side of the canvas, so parallax never reveals an edge. */
export const RIDGE_MARGIN = 16;

/**
 * Crest heights for `width + 2·margin` columns (index 0 = `−margin`), in canvas pixels from the top, as integers — whole pixels, because
 * pixel art has no half-pixel crests. Independent per layer through `seed + layer`.
 */
export function ridgeProfile(spec: RidgeSpec, layer: number, width: number, height: number, seed: number, margin = RIDGE_MARGIN): Int16Array {
  const cols = width + 2 * margin;
  const out = new Int16Array(cols);
  const rng = mulberry32((seed ^ (layer * 0x9e3779b1)) >>> 0);
  const offset = rng() * 200;
  const s = (seed + layer * 977) | 0;
  for (let i = 0; i < cols; i++) {
    const x = (i - margin) / width; // 0…1 across the visible canvas
    const n = fbm1(x * spec.freq + offset, spec.octaves, s);
    const crest = lerp(n, 1 - Math.abs(2 * n - 1), spec.ridged);
    // centre the noise so `base` is the mean line; keep it as a height *above* the base (smaller y = taller)
    const y = height * (spec.base - spec.amp * (crest - 0.5) * 2);
    out[i] = Math.round(clamp(y, height * 0.2, height - 1));
  }
  return out;
}

/** Pine silhouettes for the nearest ridge: one `[x, topY, height]` triple per tree, planted along the crest (never on a steep drop). */
export function treeLine(profile: Int16Array, seed: number, density = 0.12, margin = RIDGE_MARGIN): Array<[number, number, number]> {
  const rng = mulberry32(seed ^ 0x7ee5);
  const trees: Array<[number, number, number]> = [];
  let x = 2;
  while (x < profile.length - 2) {
    const slope = Math.abs((profile[Math.min(profile.length - 1, x + 2)] as number) - (profile[Math.max(0, x - 2)] as number));
    if (rng() < density && slope <= 3) {
      const h = 6 + Math.floor(rng() * 12);
      trees.push([x - margin, (profile[x] as number) - h + 2, h]);
      x += 3 + Math.floor(rng() * 4);
    } else x += 1;
  }
  return trees;
}

/** Whether pixel (x, y) is inside a pine of height `h` whose apex is at (cx, top): a stack of triangles, two rows per step. */
export function inPine(x: number, y: number, cx: number, top: number, h: number): boolean {
  const dy = y - top;
  if (dy < 0 || dy >= h) return false;
  // trunk in the last two rows, otherwise the triangle widens by one pixel every two rows, with a notch every 5 rows (a tiered fir)
  if (dy >= h - 2) return x === cx;
  const tier = dy % 5;
  const half = Math.floor(dy / 2.2) - (tier === 0 ? 1 : 0);
  return Math.abs(x - cx) <= Math.max(0, Math.min(half, 3 + (h >> 3)));
}
