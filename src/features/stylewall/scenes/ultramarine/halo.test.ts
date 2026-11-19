import { describe, expect, it } from 'vitest';
import { blueNoise } from '../../dither';
import { must } from '../../testUtil';
import { DUST_STRIDE, generateDust } from './dust';
import { groundFor, inkFor, mixPalette, paletteFor } from './palette';
import { generateRays, makeSheaves, RAY_BUCKETS, RAY_STRIDE } from './rays';
import { makeBodies, RINGS, ringSegments } from './rings';
import { ultraLayout, ultraSize } from './scene';
import { glowMask, grainTile, roundelDots } from './stipple';

describe('rays', () => {
  const buckets = generateRays(11);

  it('makes the configured number of rays per weight, each pointing outward from the roundel', () => {
    buckets.forEach((b, i) => {
      expect(b.rays).toHaveLength(must(RAY_BUCKETS[i]).count * RAY_STRIDE);
      for (let k = 0; k < b.rays.length; k += RAY_STRIDE) {
        const r0 = must(b.rays[k + 1]);
        const r1 = must(b.rays[k + 2]);
        expect(r0).toBeGreaterThanOrEqual(1.1);
        expect(r1).toBeGreaterThan(r0);
        expect(Math.abs(must(b.rays[k + 3]))).toBeLessThan(0.6); // a lean, not a spiral
      }
    });
  });

  it('is deterministic for a seed and different for another', () => {
    expect([...must(generateRays(11)[0]).rays]).toEqual([...must(buckets[0]).rays]);
    expect([...must(generateRays(12)[0]).rays]).not.toEqual([...must(buckets[0]).rays]);
  });

  it('gathers in sheaves: the angular histogram is far from uniform (it is an engraving, not a starburst)', () => {
    const bins = new Array(72).fill(0) as number[];
    for (const b of buckets)
      for (let k = 0; k < b.rays.length; k += RAY_STRIDE) {
        const bi = Math.floor((((must(b.rays[k]) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / ((2 * Math.PI) / 72));
        bins[bi] = (bins[bi] ?? 0) + 1;
      }
    const mean = bins.reduce((a, c) => a + c, 0) / bins.length;
    const sd = Math.sqrt(bins.reduce((a, c) => a + (c - mean) ** 2, 0) / bins.length);
    expect(sd / mean).toBeGreaterThan(0.5);
    expect(Math.min(...bins)).toBeLessThan(mean * 0.35); // real gaps between sheaves
  });

  it('weights get thinner and rarer from fine to bold, and every weight turns at its own pace', () => {
    for (let i = 1; i < RAY_BUCKETS.length; i++) {
      expect(must(RAY_BUCKETS[i]).width).toBeGreaterThan(must(RAY_BUCKETS[i - 1]).width);
      expect(must(RAY_BUCKETS[i]).count).toBeLessThan(must(RAY_BUCKETS[i - 1]).count);
    }
    expect(new Set(buckets.map((b) => b.speed)).size).toBe(buckets.length);
    for (const b of buckets) expect(Math.abs(b.speed)).toBeLessThan(0.003); // imperceptibly slow: < 0.01° per frame at 30 fps
  });

  it('lets sheaves reach different distances, so the halo outline is ragged', () => {
    const reach = makeSheaves(11).map((s) => s.reach);
    expect(Math.max(...reach) - Math.min(...reach)).toBeGreaterThan(1);
  });
});

describe('orrery', () => {
  it('draws one tick per step on a tick ring, with longer marks on the strides', () => {
    const idx = RINGS.findIndex((r) => r.ticks?.count === 144);
    const segs = ringSegments(must(RINGS[idx]), idx, 5);
    expect(segs).toHaveLength(144);
    const len = (s: number[]) => Math.hypot(must(s[2]) - must(s[0]), must(s[3]) - must(s[1]));
    const [short, mid, long] = must(must(RINGS[idx]).ticks).len;
    expect(len(must(segs[1]))).toBeCloseTo(short, 5);
    expect(len(must(segs[6]))).toBeCloseTo(mid, 5);
    expect(len(must(segs[12]))).toBeCloseTo(long, 5);
  });

  it('frames each glyph box with four sides, a mark and a stalk, deterministically', () => {
    const idx = RINGS.findIndex((r) => r.boxes && !r.ticks);
    const a = ringSegments(must(RINGS[idx]), idx, 5);
    expect(a.length).toBeGreaterThanOrEqual(must(must(RINGS[idx]).boxes).count * 6);
    expect(ringSegments(must(RINGS[idx]), idx, 5)).toEqual(a);
    expect(ringSegments(must(RINGS[idx]), idx, 6)).not.toEqual(a);
  });

  it('nests its rings and keeps the outermost turning slowest', () => {
    for (let i = 1; i < RINGS.length; i++) expect(must(RINGS[i]).r).toBeGreaterThan(must(RINGS[i - 1]).r);
    for (const r of RINGS) expect(Math.abs(r.speed)).toBeLessThan(0.005);
  });

  it('puts every orbiting body on a real ring', () => {
    for (const b of makeBodies(3)) expect(RINGS[b.ring]).toBeDefined();
  });
});

describe('dust, stipple and grain', () => {
  it('lays out dust deterministically, outside the roundel', () => {
    const d = generateDust(4, 120);
    expect(d.count).toBe(120);
    for (let i = 0; i < d.count; i++) expect(must(d.data[i * DUST_STRIDE])).toBeGreaterThan(1.2);
    expect([...generateDust(4, 120).data]).toEqual([...d.data]);
  });

  const bn = blueNoise(16, 7);
  it('thins the glow from the centre to the rim and keeps it out of the middle', () => {
    const m = glowMask(96, bn, 16, 3, 0.3, 0.8);
    const count = (r0: number, r1: number) => {
      let n = 0;
      let total = 0;
      for (let y = 0; y < 96; y++)
        for (let x = 0; x < 96; x++) {
          const d = Math.hypot(x + 0.5 - 48, y + 0.5 - 48) / 48;
          if (d >= r0 && d < r1) {
            total++;
            n += must(m[y * 96 + x]);
          }
        }
      return n / total;
    };
    expect(count(0, 0.28)).toBe(0);
    expect(count(0.32, 0.5)).toBeGreaterThan(count(0.7, 0.9));
    expect(count(0.97, 1)).toBeLessThan(0.05);
  });

  it('textures the roundel with light dots behind the head and dark dots toward the rim', () => {
    const size = 128;
    const m = roundelDots(size, bn, 16);
    const share = (cls: number, r0: number, r1: number) => {
      let n = 0;
      let total = 0;
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const d = Math.hypot(x + 0.5 - 64, y + 0.5 - 64) / 64;
          if (d >= r0 && d < r1) {
            total++;
            if (m[y * size + x] === cls) n++;
          }
        }
      return n / total;
    };
    expect(share(2, 0.85, 1)).toBeGreaterThan(share(2, 0.1, 0.4));
    expect(share(1, 0.1, 0.5)).toBeGreaterThan(share(1, 0.85, 1));
    expect(m[0]).toBe(0); // outside the circle
  });

  it('makes a grain tile that is mostly empty with a few specks, and repeatable', () => {
    const t = grainTile(64, 2);
    const lit = [...t].filter((v) => v > 0).length;
    expect(lit / t.length).toBeGreaterThan(0.12);
    expect(lit / t.length).toBeLessThan(0.4);
    expect([...grainTile(64, 2)]).toEqual([...t]);
    expect([...grainTile(64, 3)]).not.toEqual([...t]);
  });
});

describe('palette and layout', () => {
  it('derives a saturated ultramarine ground from the default accent', () => {
    const [r, g, b] = groundFor('#3a3aff');
    expect(b).toBeGreaterThan(200);
    expect(r).toBeLessThan(80);
    expect(g).toBeLessThan(80);
  });
  it('follows the accent hue (a green accent gives a green plate, not a blue one)', () => {
    const [r, g, b] = groundFor('#2fc460');
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    expect(inkFor('#2fc460', true)[1]).toBeGreaterThan(inkFor('#2fc460', true)[2]);
  });
  it('lerps between light and dark without overshoot', () => {
    const a = paletteFor('#3a3aff', false);
    const b = paletteFor('#3a3aff', true);
    expect(mixPalette(a, b, 0).field).toEqual(a.field);
    expect(mixPalette(a, b, 1).field).toEqual(b.field);
    const mid = mixPalette(a, b, 0.5);
    for (let i = 0; i < 3; i++) expect(must(mid.field[i])).toBeCloseTo((must(a.field[i]) + must(b.field[i])) / 2, 6);
  });
  it('sizes the canvas at up to 2 css pixels per pixel but never more than ~2.8 M pixels, and never below 1 per css pixel', () => {
    const s = ultraSize(1440, 900, 2);
    expect(s.smooth).toBe(true);
    expect(s.w * s.h).toBeLessThanOrEqual(2.9e6);
    expect(s.w).toBeGreaterThan(1440);
    expect(ultraSize(1440, 900, 1)).toMatchObject({ w: 1440, h: 900 });
    expect(ultraSize(390, 844, 3)).toMatchObject({ w: 780, h: 1688 });
    expect(ultraSize(3840, 2160, 2).w).toBeGreaterThanOrEqual(3840);
  });
  it('puts the halo right of centre on landscape (the content column stays calm) and centred on a phone, roundel inside the canvas', () => {
    const l = ultraLayout(2000, 1250);
    expect(l.cx).toBeGreaterThan(1000);
    expect(l.cx + l.R0).toBeLessThanOrEqual(2000);
    expect(l.cy - l.R0).toBeGreaterThan(0);
    const p = ultraLayout(780, 1688);
    expect(p.cx).toBe(390);
    expect(p.portrait).toBe(true);
    expect(p.cx - p.R0).toBeGreaterThan(0);
  });
});
