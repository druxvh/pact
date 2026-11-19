import { describe, expect, it } from 'vitest';
import { must } from '../../testUtil';
import { DUSK_DARK, DUSK_LIGHT } from './palette';
import { inPine, RIDGE_MARGIN, RIDGES, ridgeProfile, treeLine } from './ridges';
import { duskCell, duskLayout, duskSize } from './scene';

const W = 480;
const H = 300;

describe('ridgeProfile', () => {
  it('covers the canvas plus a parallax margin each side, as whole pixels inside the canvas', () => {
    for (let i = 0; i < RIDGES.length; i++) {
      const p = ridgeProfile(must(RIDGES[i]), i, W, H, 7);
      expect(p).toHaveLength(W + 2 * RIDGE_MARGIN);
      for (const y of p) {
        expect(Number.isInteger(y)).toBe(true);
        expect(y).toBeGreaterThanOrEqual(H * 0.2);
        expect(y).toBeLessThanOrEqual(H - 1);
      }
    }
  });

  it('is deterministic for a seed, and different for another seed or another layer', () => {
    const a = ridgeProfile(must(RIDGES[1]), 1, W, H, 7);
    expect([...ridgeProfile(must(RIDGES[1]), 1, W, H, 7)]).toEqual([...a]);
    expect([...ridgeProfile(must(RIDGES[1]), 1, W, H, 8)]).not.toEqual([...a]);
    expect([...ridgeProfile(must(RIDGES[1]), 2, W, H, 7)]).not.toEqual([...a]);
  });

  it('stacks far → near: each nearer ridge sits lower on average', () => {
    const mean = (p: Int16Array) => p.reduce((s, v) => s + v, 0) / p.length;
    const means = RIDGES.map((r, i) => mean(ridgeProfile(r, i, W, H, 7)));
    for (let i = 1; i < means.length; i++) expect(must(means[i])).toBeGreaterThan(must(means[i - 1]));
  });

  it('scales with the canvas: the same shape at twice the size', () => {
    const small = ridgeProfile(must(RIDGES[2]), 2, 240, 150, 7, 0);
    const big = ridgeProfile(must(RIDGES[2]), 2, 480, 300, 7, 0);
    for (let i = 0; i < 240; i += 24) expect(Math.abs(must(big[i * 2]) - must(small[i]) * 2)).toBeLessThanOrEqual(3);
  });
});

describe('trees', () => {
  const profile = ridgeProfile(must(RIDGES[4]), 4, W, H, 7);
  const trees = treeLine(profile, 7);
  it('plants pines along the crest, deterministically, never overlapping', () => {
    expect(trees.length).toBeGreaterThan(10);
    expect(treeLine(profile, 7)).toEqual(trees);
    for (let i = 1; i < trees.length; i++) expect(must(trees[i])[0] - must(trees[i - 1])[0]).toBeGreaterThanOrEqual(3);
  });
  it('draws a pine as a widening stack with a trunk', () => {
    expect(inPine(10, 5, 10, 5, 12)).toBe(true); // the apex
    expect(inPine(10, 4, 10, 5, 12)).toBe(false); // above
    expect(inPine(10, 16, 10, 5, 12)).toBe(true); // trunk
    expect(inPine(12, 16, 10, 5, 12)).toBe(false); // trunk is one pixel wide
    const width = (y: number) => [...Array(15).keys()].filter((x) => inPine(x, y, 7, 0, 14)).length;
    expect(width(8)).toBeGreaterThan(width(2));
  });
});

describe('dusk layout', () => {
  it('uses a chunkier pixel on bigger windows but never below 2 css px', () => {
    expect(duskCell(1440)).toBe(3);
    expect(duskCell(1920)).toBe(4);
    expect(duskCell(390)).toBe(2);
  });
  it('asks for a low-resolution canvas that is not smoothed', () => {
    const s = duskSize(1440, 900);
    expect(s).toEqual({ w: 480, h: 300, smooth: false });
    expect(duskSize(2560, 1440).w).toBeLessThanOrEqual(640);
  });
  it('keeps the sun and moon on the canvas, the sun right of centre on landscape and centred-ish on a phone', () => {
    const l = duskLayout(480, 300);
    expect(l.sun.x).toBeGreaterThan(240);
    expect(l.sun.x + l.sun.r).toBeLessThan(480);
    expect(l.moon.x - l.moon.r).toBeGreaterThan(0);
    const p = duskLayout(195, 422);
    expect(p.sun.x - p.sun.r).toBeGreaterThan(0);
    expect(p.sun.x + p.sun.r).toBeLessThan(195);
  });
});

describe('dusk palettes', () => {
  it('have a seven-step sky and five ridges, all #rrggbb', () => {
    for (const p of [DUSK_DARK, DUSK_LIGHT]) {
      expect(p.sky).toHaveLength(7);
      expect(p.ridges).toHaveLength(RIDGES.length);
      for (const c of [...p.sky, ...p.ridges, p.haze, p.rim, ...p.sun, ...p.moon, ...p.cloud, p.star, p.starBright, p.bird])
        expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it('start the sky at the Dusk style page colours (the zenith melts into the page)', () => {
    expect(DUSK_DARK.sky[0]).toBe('#191724');
    expect(DUSK_LIGHT.sky[0]).toBe('#faf4ed');
  });
  it('darken toward the viewer in dusk, and the far ridges are the lightest', () => {
    const luma = (h: string) => {
      const n = Number.parseInt(h.slice(1), 16);
      return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114;
    };
    for (let i = 1; i < DUSK_DARK.ridges.length; i++) expect(luma(must(DUSK_DARK.ridges[i]))).toBeLessThan(luma(must(DUSK_DARK.ridges[i - 1])));
    for (let i = 1; i < DUSK_LIGHT.ridges.length; i++) expect(luma(must(DUSK_LIGHT.ridges[i]))).toBeLessThan(luma(must(DUSK_LIGHT.ridges[i - 1])));
  });
});
