import { describe, expect, it } from 'vitest';
import { fbm1, fbm2, noise2, tileFbm } from './noise';
import { clamp, gauss, mulberry32, smoothstep } from './rng';

describe('noise', () => {
  it('is deterministic, in [0, 1), and differs by seed', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const v = fbm2(x, x * 0.5, 4, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(fbm2(x, x * 0.5, 4, 3)).toBe(v);
    }
    expect(fbm1(2.2, 4, 1)).not.toBe(fbm1(2.2, 4, 2));
  });

  it('is smooth: a small step moves the value only a little', () => {
    let worst = 0;
    for (let i = 0; i < 400; i++) worst = Math.max(worst, Math.abs(noise2(i * 0.01, 3.3) - noise2(i * 0.01 + 0.01, 3.3)));
    expect(worst).toBeLessThan(0.05);
  });

  it('tileFbm repeats exactly every `period` cells, so cloud strips wrap without a seam', () => {
    for (const period of [3, 5, 8]) {
      for (let i = 0; i < 40; i++) {
        const x = i * 0.31;
        expect(tileFbm(x, 0.7, period, 4, 9)).toBeCloseTo(tileFbm(x + period, 0.7, period, 4, 9), 9);
      }
    }
  });
});

describe('rng', () => {
  it('mulberry32 repeats for a seed', () => {
    const a = mulberry32(5);
    const b = mulberry32(5);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });
  it('gauss is centred and bounded in practice', () => {
    const r = mulberry32(11);
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += gauss(r);
    expect(Math.abs(sum / 4000)).toBeLessThan(0.08);
  });
  it('clamp / smoothstep', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6);
    expect(smoothstep(0, 1, -1)).toBe(0);
  });
});
