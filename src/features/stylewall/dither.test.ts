import { describe, expect, it } from 'vitest';
import { bayerThresholds, blueNoise, ditherIndex, nearestIndex } from './dither';
import { must } from './testUtil';

describe('bayerThresholds', () => {
  it('is the classic 4×4 ordered-dither matrix, as thresholds strictly inside (0, 1)', () => {
    const ranks = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const t = bayerThresholds(4);
    expect([...t].map((v) => Math.round(v * 16 - 0.5))).toEqual(ranks);
    for (const v of t) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('uses every threshold exactly once at every size, so a density d lights exactly d of the cells', () => {
    for (const n of [2, 4, 8, 16]) {
      const t = [...bayerThresholds(n)].sort((a, b) => a - b);
      for (let i = 0; i < t.length; i++) expect(t[i]).toBeCloseTo((i + 0.5) / (n * n), 6);
      const lit = [...bayerThresholds(n)].filter((v) => v < 0.25).length;
      expect(lit).toBe((n * n) / 4);
    }
  });

  it('rejects sizes that are not a power of two', () => {
    expect(() => bayerThresholds(3)).toThrow();
    expect(() => bayerThresholds(128)).toThrow();
  });
});

describe('blueNoise', () => {
  const N = 16;
  const tile = blueNoise(N, 3);

  it('is a permutation of ranks: every threshold appears once', () => {
    expect(tile).toHaveLength(N * N);
    const sorted = [...tile].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) expect(sorted[i]).toBeCloseTo((i + 0.5) / (N * N), 5);
  });

  it('is deterministic for a seed and different for another', () => {
    expect([...blueNoise(N, 3)]).toEqual([...tile]);
    expect([...blueNoise(N, 4)]).not.toEqual([...tile]);
  });

  it('spreads its points evenly: at 10% density no two lit cells are neighbours (toroidal), unlike white noise', () => {
    const lit: Array<[number, number]> = [];
    tile.forEach((v, i) => {
      if (v < 0.1) lit.push([i % N, Math.floor(i / N)]);
    });
    expect(lit.length).toBe(Math.round(N * N * 0.1));
    let min = Number.POSITIVE_INFINITY;
    for (let a = 0; a < lit.length; a++)
      for (let b = a + 1; b < lit.length; b++) {
        const dx = Math.min(Math.abs(must(lit[a])[0] - must(lit[b])[0]), N - Math.abs(must(lit[a])[0] - must(lit[b])[0]));
        const dy = Math.min(Math.abs(must(lit[a])[1] - must(lit[b])[1]), N - Math.abs(must(lit[a])[1] - must(lit[b])[1]));
        min = Math.min(min, Math.hypot(dx, dy));
      }
    expect(min).toBeGreaterThanOrEqual(2);
  });
});

describe('ditherIndex', () => {
  it('only ever mixes two neighbouring palette slots', () => {
    for (const v of [0, 0.3, 1.5, 2.49, 5.9]) {
      const seen = new Set<number>();
      for (const th of [0.01, 0.3, 0.5, 0.7, 0.99]) seen.add(ditherIndex(v, 6, th));
      expect(seen.size).toBeLessThanOrEqual(2);
      const lo = Math.floor(v);
      for (const s of seen) expect([lo, lo + 1]).toContain(s);
    }
  });

  it('rounds up exactly when the fraction beats the threshold, and clamps to the palette', () => {
    expect(ditherIndex(2.5, 6, 0.4)).toBe(3);
    expect(ditherIndex(2.5, 6, 0.6)).toBe(2);
    expect(ditherIndex(-3, 6, 0.5)).toBe(0);
    expect(ditherIndex(99, 6, 0.5)).toBe(6);
  });

  it('lights a share of cells equal to the fraction over a Bayer matrix', () => {
    const t = bayerThresholds(8);
    const up = [...t].filter((th) => ditherIndex(3.25, 6, th) === 4).length;
    expect(up / 64).toBeCloseTo(0.25, 2);
  });
});

describe('nearestIndex', () => {
  it('finds the closest palette colour', () => {
    const pal = [
      [0, 0, 0],
      [255, 0, 0],
      [0, 0, 255],
    ] as const;
    expect(nearestIndex(pal, 250, 10, 10)).toBe(1);
    expect(nearestIndex(pal, 5, 5, 200)).toBe(2);
  });
});
