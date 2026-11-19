/**
 * Deterministic value noise for the scenes' generators: 1D and 2D, fractal sums, and a `seed`-keyed lattice so two scenes (or two ridges) never share a pattern.
 * Everything is pure and allocation-free; the scenes call it at build time (resize), not per frame.
 */

const hash2 = (x: number, y: number, seed: number): number => {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth 2D value noise in [0, 1). */
export function noise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Smooth 1D value noise in [0, 1). */
export const noise1 = (x: number, seed = 0): number => noise2(x, seed * 7.31 + 0.5, seed);

/** Fractal noise in [0, 1], `octaves` layers (each twice as fine and half as strong). */
export function fbm2(x: number, y: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(fx, fy, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    fx = fx * 2.02 + 11.3;
    fy = fy * 2.02 + 5.7;
  }
  return sum / norm;
}

export const fbm1 = (x: number, octaves = 4, seed = 0): number => fbm2(x, seed * 3.7 + 0.25, octaves, seed);

/**
 * Noise that repeats every `period` along x (a horizontally tileable strip: the clouds wrap around without a seam).
 * `period` is in lattice cells of the *first* octave, and must be an integer.
 */
export function tileFbm(x: number, y: number, period: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = period;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    const xi = Math.floor(fx);
    const yi = Math.floor(fy);
    const u = fade(fx - xi);
    const v = fade(fy - yi);
    const s = seed + i * 31;
    const a = hash2(((xi % p) + p) % p, yi, s);
    const b = hash2((((xi + 1) % p) + p) % p, yi, s);
    const c = hash2(((xi % p) + p) % p, yi + 1, s);
    const d = hash2((((xi + 1) % p) + p) % p, yi + 1, s);
    sum += amp * (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v);
    norm += amp;
    amp *= 0.5;
    p *= 2;
    fx *= 2;
    fy = fy * 2 + 3.1;
  }
  return sum / norm;
}
