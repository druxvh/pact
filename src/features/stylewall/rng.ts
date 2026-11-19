/** Seeded random numbers (mulberry32): the same seed always draws the same scene, so the generators built on it can be tested. */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform in [a, b). */
export const between = (r: Rng, a: number, b: number): number => a + (b - a) * r();

/** An integer in [a, b]. */
export const int = (r: Rng, a: number, b: number): number => a + Math.floor(r() * (b - a + 1));

/** Roughly normal (mean 0, sd 1): sum of four uniforms. */
export const gauss = (r: Rng): number => (r() + r() + r() + r() - 2) * 1.7320508;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
