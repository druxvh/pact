/** A small seeded random generator (mulberry32): the same seed always gives the same sequence, so the generators built on it can be tested. */
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

/** True with probability p. */
export const chance = (r: Rng, p: number): boolean => r() < p;

/** An integer in [a, b]. */
export const int = (r: Rng, a: number, b: number): number => a + Math.floor(r() * (b - a + 1));

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
