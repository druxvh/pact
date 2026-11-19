/**
 * The halo's rays: pure, seeded layout of ~2000 hairlines so the halo reads as an engraving, not a vector starburst.
 *
 * Rays gather into *sheaves* (clusters of near-parallel lines, like the threads in the reference engraving), with gaps between them where
 * a slow noise thins the field out. Each sheaf has its own reach, so the halo's outline is ragged. Line weight is the bucket a ray falls
 * in (a canvas stroke has one width, so each bucket is one stroke): five weights, each with its own slow rotation and alpha, so as they
 * drift past one another the field shimmers. All radii are in units of the roundel radius R0.
 */
import { noise1 } from '../../noise';
import { gauss, mulberry32 } from '../../rng';

export type RayBucket = {
  /** Stroke width in CSS pixels. */
  width: number;
  alpha: number;
  /** Radians per second (signed). */
  speed: number;
  /** A slow breathing of the alpha: amplitude (0…1 of alpha) and rate (rad/s). */
  breath: { amp: number; rate: number; phase: number };
  /** Per ray `[angle, r0, r1, lean]`: radii in R0 units, `lean` = extra angle (rad) the line has gained by its far end. */
  rays: Float32Array;
};

const TAU = Math.PI * 2;

/** Floats per ray in {@link RayBucket.rays}. */
export const RAY_STRIDE = 4;

export const RAY_BUCKETS = [
  { width: 0.5, alpha: 0.5, speed: 0.0016, count: 1400 },
  { width: 0.65, alpha: 0.55, speed: -0.0011, count: 900 },
  { width: 0.8, alpha: 0.6, speed: 0.0007, count: 520 },
  { width: 1.0, alpha: 0.66, speed: -0.0005, count: 200 },
  { width: 1.25, alpha: 0.85, speed: 0.0003, count: 70 },
] as const;

export type Sheaf = { angle: number; weight: number; spread: number; reach: number };

/** The sheaves: where the clusters sit, how wide they fan and how far they reach (R0 units). */
export function makeSheaves(seed: number, count = 46): Sheaf[] {
  const rng = mulberry32(seed ^ 0x5eaf);
  const out: Sheaf[] = [];
  for (let j = 0; j < count; j++) {
    const angle = ((j + (rng() - 0.5) * 0.8) / count) * TAU;
    const thin = noise1(angle * 1.6 + 3, seed);
    out.push({
      angle,
      weight: 0.35 + rng() * 0.9 + (thin > 0.55 ? 0.5 : 0),
      spread: 0.006 + rng() ** 2 * 0.04,
      reach: 1.55 + rng() ** 1.5 * 2.2 + (thin > 0.6 ? 0.4 : 0),
    });
  }
  return out;
}

export function generateRays(seed: number): RayBucket[] {
  const sheaves = makeSheaves(seed);
  const total = sheaves.reduce((a, s) => a + s.weight, 0);
  const rng = mulberry32(seed ^ 0xbadc0de);
  const pick = (): Sheaf => {
    let r = rng() * total;
    for (const s of sheaves) {
      r -= s.weight;
      if (r <= 0) return s;
    }
    return sheaves[0] as Sheaf;
  };
  return RAY_BUCKETS.map((b, bi) => {
    const data = new Float32Array(b.count * RAY_STRIDE);
    let k = 0;
    while (k < b.count) {
      const free = rng() < 0.07;
      const s = pick();
      const bold = bi >= 3;
      const a = free ? rng() * TAU : s.angle + gauss(rng) * s.spread * (bold ? 0.45 : 1);
      // the field thins where a slow noise is low, so the halo has dark gaps between its sheaves
      const field = noise1(a * 2.3 + 11, seed);
      if (!bold && rng() > 0.05 + field * field * 1.6) continue;
      // Two populations: *inner* rays that spring from the roundel, and *outer* sheaves that begin out past the rings, so the orrery stays readable.
      const inner = rng() < (bold ? 0.55 : 0.3);
      const r0 = inner ? 1.1 + rng() ** 2 * 0.5 : 1.55 + rng() ** 1.6 * 1.1;
      const reach = free ? 1.3 + rng() * 0.9 : s.reach * (0.62 + rng() ** 0.7 * 0.52 + (bold ? 0.2 : 0));
      const r1 = Math.max(r0 + 0.18, inner ? Math.min(reach, 1.5 + rng() * 1.4) : reach + 0.3);
      // the sheaf leans: its lines are pulled sideways as they run out, by an amount that varies smoothly round the halo (wind in the threads)
      const lean = (noise1(s.angle * 1.3 + 40, seed) - 0.5) * 0.34 * (r1 - r0) + gauss(rng) * 0.004;
      data.set([a, r0, r1, lean], k * RAY_STRIDE);
      k++;
    }
    return {
      width: b.width,
      alpha: b.alpha,
      speed: b.speed,
      breath: { amp: 0.14, rate: 0.13 + bi * 0.037, phase: bi * 1.7 },
      rays: data,
    };
  });
}
