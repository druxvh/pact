/**
 * Dither thresholds and palette quantisation — the pure maths behind both scenes' "crafted, limited palette" look.
 *
 *  • `bayerThresholds(n)` — the classic ordered-dither matrix as thresholds strictly inside (0, 1): the pixel-art look (Dusk's sky).
 *  • `blueNoise(size, seed)` — a tileable blue-noise threshold tile made by void-and-cluster: stipple without the visible
 *    grid or clumps (Ultramarine's glow, dust and grain).
 *  • `ditherIndex` — quantise a value in [0, steps] to one of `steps + 1` palette slots, dithering *between neighbours only*, so a
 *    gradient made of 6 colours only ever shows 2 adjacent colours mixed — that is what keeps it reading as hand-placed pixels.
 */

/** The n×n Bayer matrix (n a power of two, 2…64) as thresholds in (0, 1), row-major: `(rank + 0.5) / n²`. */
export function bayerThresholds(n: number): Float32Array {
  if (n < 2 || n > 64 || (n & (n - 1)) !== 0) throw new Error('Bayer size must be a power of two, 2…64');
  // Standard recursive construction on ranks: M(2n) = [[4M, 4M+2], [4M+3, 4M+1]].
  let m: number[] = [0];
  let size = 1;
  while (size < n) {
    const next = new Array<number>(size * size * 4);
    const s2 = size * 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = 4 * (m[y * size + x] as number);
        next[y * s2 + x] = v;
        next[y * s2 + x + size] = v + 2;
        next[(y + size) * s2 + x] = v + 3;
        next[(y + size) * s2 + x + size] = v + 1;
      }
    }
    m = next;
    size = s2;
  }
  const out = new Float32Array(n * n);
  for (let i = 0; i < out.length; i++) out[i] = ((m[i] as number) + 0.5) / (n * n);
  return out;
}

/**
 * Tileable blue-noise thresholds (void-and-cluster, Ulichney 1993). Returns `size²` values in (0, 1): every threshold appears exactly once
 * (a permutation of ranks), so thresholding it at density d lights *exactly* d of the cells, spread evenly with no clumps.
 * Deterministic for a seed; the cost is ~size⁴/8 simple steps (32² ≈ 2 ms, 64² ≈ 40 ms).
 */
export function blueNoise(size: number, seed = 1): Float32Array {
  const N = size * size;
  const sigma = 1.5;
  const R = Math.ceil(sigma * 3);
  const kw = 2 * R + 1;
  const kernel = new Float32Array(kw * kw);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) kernel[(dy + R) * kw + dx + R] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));

  /** Add (+1) or remove (−1) a point's Gaussian energy, wrapping around the tile. */
  const splat = (energy: Float32Array, i: number, sign: 1 | -1) => {
    const x = i % size;
    const y = (i / size) | 0;
    for (let dy = -R; dy <= R; dy++) {
      const row = ((y + dy + size) % size) * size;
      for (let dx = -R; dx <= R; dx++) {
        const j = row + ((x + dx + size) % size);
        energy[j] = (energy[j] as number) + sign * (kernel[(dy + R) * kw + dx + R] as number);
      }
    }
  };
  /** The point (bit = 1) with the most energy around it — the tightest cluster. */
  const tightest = (bits: Uint8Array, energy: Float32Array) => {
    let best = -1;
    let bv = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < N; i++) {
      if (bits[i] === 1 && (energy[i] as number) > bv) {
        bv = energy[i] as number;
        best = i;
      }
    }
    return best;
  };
  /** The empty cell (bit = 0) with the least energy around it — the largest void. */
  const largestVoid = (bits: Uint8Array, energy: Float32Array) => {
    let best = -1;
    let bv = Number.POSITIVE_INFINITY;
    for (let i = 0; i < N; i++) {
      if (bits[i] === 0 && (energy[i] as number) < bv) {
        bv = energy[i] as number;
        best = i;
      }
    }
    return best;
  };

  // Initial pattern: ~10 % random cells, relaxed until the tightest cluster and the largest void coincide.
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const bits = new Uint8Array(N);
  const energy = new Float32Array(N);
  const ones = Math.max(2, Math.floor(N * 0.1));
  for (let placed = 0; placed < ones; ) {
    const i = Math.floor(rnd() * N);
    if (!bits[i]) {
      bits[i] = 1;
      splat(energy, i, 1);
      placed++;
    }
  }
  for (let guard = 0; guard < N; guard++) {
    const c = tightest(bits, energy);
    bits[c] = 0;
    splat(energy, c, -1);
    const v = largestVoid(bits, energy);
    bits[v] = 1;
    splat(energy, v, 1);
    if (v === c) break;
  }

  const rank = new Float32Array(N);
  // Phase 1: peel the initial points off, tightest cluster first — they get the lowest ranks.
  const peel = bits.slice();
  const peelEnergy = energy.slice();
  for (let r = ones; r > 0; r--) {
    const c = tightest(peel, peelEnergy);
    peel[c] = 0;
    splat(peelEnergy, c, -1);
    rank[c] = r - 1;
  }
  // Phases 2 and 3 (they are one rule: fill the largest void; past half-full the largest void *is* the tightest cluster of the remaining empty cells).
  for (let r = ones; r < N; r++) {
    const v = largestVoid(bits, energy);
    bits[v] = 1;
    splat(energy, v, 1);
    rank[v] = r;
  }

  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = ((rank[i] as number) + 0.5) / N;
  return out;
}

/**
 * Ordered dither of `value` (0 … steps) to a palette slot in 0 … steps. Between two neighbouring slots the fractional part is
 * compared with the threshold, so only adjacent palette colours ever mix.
 */
export function ditherIndex(value: number, steps: number, threshold: number): number {
  const v = Math.min(steps, Math.max(0, value));
  const base = Math.floor(v);
  const idx = v - base > threshold ? base + 1 : base;
  return Math.min(steps, idx);
}

/** Index of the nearest colour in a palette (squared RGB distance) — used to verify a baked image only uses its palette. */
export function nearestIndex(palette: ReadonlyArray<readonly [number, number, number]>, r: number, g: number, b: number): number {
  let best = 0;
  let bd = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i] as readonly [number, number, number];
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}
