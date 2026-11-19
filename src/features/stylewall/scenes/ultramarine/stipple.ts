/** Pure stipple/grain generators for Engraved Halo (typed arrays in, typed arrays out; the scene turns them into canvases). */
import { mulberry32 } from '../../rng';

const TAU = Math.PI * 2;

/**
 * A radial stipple glow as a 0/1 mask of `size × size`: dots thin out from the centre to the rim by `(1 − d)^power`, with an angular
 * modulation so the glow is lopsided like a lit engraving, thresholded against blue noise (no grid, no clumps).
 */
export function glowMask(size: number, bn: Float32Array, bnSize: number, seed: number, inner = 0.3, strength = 0.62): Uint8Array {
  const out = new Uint8Array(size * size);
  const rng = mulberry32(seed ^ 0x610);
  const lobes = [rng() * TAU, rng() * TAU, rng() * TAU];
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const d = Math.hypot(dx, dy);
      if (d >= 1 || d < inner) continue;
      const a = Math.atan2(dy, dx);
      const mod = 0.8 + 0.2 * Math.sin(a * 2 + (lobes[0] as number)) + 0.12 * Math.sin(a * 3 + (lobes[1] as number));
      const t = (d - inner) / (1 - inner);
      const p = strength * (1 - t) ** 2.3 * mod;
      if ((bn[(y % bnSize) * bnSize + (x % bnSize)] as number) < p) out[y * size + x] = 1;
    }
  }
  return out;
}

/** A film-grain tile: per pixel an alpha 0…255 (most pixels 0), a few brighter specks, so a tiled pattern reads as grain, not noise. */
export function grainTile(size: number, seed: number): Uint8Array {
  const rng = mulberry32(seed ^ 0x6a17);
  const out = new Uint8Array(size * size);
  for (let i = 0; i < out.length; i++) {
    const v = rng();
    if (v > 0.8) out[i] = Math.round(((v - 0.8) / 0.2) ** 1.6 * 150 + 20);
  }
  // clump a little: a speck bleeds a fraction into its right and lower neighbour (grain has body)
  for (let y = 0; y < size - 1; y++)
    for (let x = 0; x < size - 1; x++) {
      const v = out[y * size + x] as number;
      if (v > 90) {
        out[y * size + x + 1] = Math.max(out[y * size + x + 1] as number, v * 0.35);
        out[(y + 1) * size + x] = Math.max(out[(y + 1) * size + x] as number, v * 0.3);
      }
    }
  return out;
}

/**
 * The roundel's ground texture as classes per pixel (0 none, 1 light dot, 2 dark dot) over `size × size` (the roundel's bounding square):
 * light dots gather behind the head (an aureole of stipple), dark dots gather toward the rim so the figure sinks into a rounded plate.
 */
export function roundelDots(size: number, bn: Float32Array, bnSize: number): Uint8Array {
  const out = new Uint8Array(size * size);
  const half = size / 2;
  const cy = -0.12; // the aureole sits a little above the centre, behind the head
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const d = Math.hypot(dx, dy);
      if (d >= 1) continue;
      const n = bn[(y % bnSize) * bnSize + (x % bnSize)] as number;
      const da = Math.hypot(dx, dy - cy);
      const light = 0.6 * Math.max(0, 1 - da / 1.0) ** 1.3;
      const rim = d > 0.5 ? (d - 0.5) / 0.5 : 0;
      const dark = 0.62 * rim ** 1.5;
      if (n < light) out[y * size + x] = 1;
      else if (n > 1 - dark) out[y * size + x] = 2;
    }
  }
  return out;
}
