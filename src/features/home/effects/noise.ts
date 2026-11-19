/**
 * Cheap deterministic noise for the effects: value noise (2D), a few octaves of it, and `wave` — a sum of sines at
 * incommensurate frequencies, which is what keeps flames, hum and drifting light from ever visibly looping.
 */

const hash = (x: number, y: number): number => {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth value noise in [0, 1). */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal (fbm) noise in [0, 1], `octaves` layers. */
export function fbm(x: number, y: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(fx, fy);
    norm += amp;
    amp *= 0.5;
    fx = fx * 2.03 + 17.1;
    fy = fy * 2.03 + 9.7;
  }
  return sum / norm;
}

/** Irregular wobble in [0, 1]: three sines whose frequencies (1, φ, √7-ish) never line up, offset by `seed`. */
export function wave(t: number, seed = 0): number {
  const s = seed * 12.9898;
  return 0.5 + 0.5 * ((Math.sin(t * 1.0 + s) + Math.sin(t * 1.618 + s * 1.7) * 0.7 + Math.sin(t * 2.6458 + s * 0.6) * 0.5) / 2.2);
}

export const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
