import { describe, expect, it } from 'vitest';
import { ASPECTS, aspectRatio, cropRect, isAspectId, outputSize, thumbSize } from '@/features/camera/geometry';

describe('cropRect', () => {
  it('keeps the whole frame for "Original"', () => {
    expect(cropRect(1280, 720, null)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
  });

  it('crops a landscape frame to a centred square', () => {
    expect(cropRect(1280, 720, 1)).toEqual({ sx: 280, sy: 0, sw: 720, sh: 720 });
  });

  it('crops 16:9 to 4:3 (sides trimmed)', () => {
    expect(cropRect(1280, 720, 4 / 3)).toEqual({ sx: 160, sy: 0, sw: 960, sh: 720 });
  });

  it('leaves a 16:9 frame alone for 16:9', () => {
    expect(cropRect(1280, 720, 16 / 9)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
  });

  it('trims the top and bottom when the frame is narrower than the target (portrait camera)', () => {
    const r = cropRect(720, 1280, 16 / 9);
    expect(r.sw).toBe(720);
    expect(r.sh).toBe(404); // 405 rounded down to an even size
    expect(r.sy).toBe(438);
    expect(r.sx).toBe(0);
  });

  it('always stays inside the frame and uses even sizes', () => {
    for (const [w, h] of [
      [640, 480],
      [1920, 1080],
      [1281, 721],
      [800, 600],
      [333, 777],
    ] as const) {
      for (const a of ASPECTS) {
        const r = cropRect(w, h, a.ratio);
        expect(r.sx).toBeGreaterThanOrEqual(0);
        expect(r.sy).toBeGreaterThanOrEqual(0);
        expect(r.sx + r.sw).toBeLessThanOrEqual(w);
        expect(r.sy + r.sh).toBeLessThanOrEqual(h);
        if (a.ratio !== null) {
          expect(r.sw % 2).toBe(0);
          expect(r.sh % 2).toBe(0);
          expect(Math.abs(r.sw / r.sh - a.ratio)).toBeLessThan(0.02);
        }
      }
    }
  });

  it('returns an empty rect for an empty frame', () => {
    expect(cropRect(0, 0, 1)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});

describe('outputSize', () => {
  it('keeps the size when it fits', () => {
    expect(outputSize(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it('scales a huge frame down, keeping the shape and even sizes', () => {
    const out = outputSize(8000, 6000, 4000);
    expect(out.width).toBe(4000);
    expect(out.height).toBe(3000);
    expect(outputSize(3841, 2161, 1920).width % 2).toBe(0);
  });

  it('copes with nothing', () => {
    expect(outputSize(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe('thumbSize', () => {
  it('fits the long edge', () => {
    expect(thumbSize(1280, 720, 320)).toEqual({ width: 320, height: 180 });
    expect(thumbSize(720, 1280, 320)).toEqual({ width: 180, height: 320 });
  });

  it('never enlarges', () => {
    expect(thumbSize(100, 50, 320)).toEqual({ width: 100, height: 50 });
  });
});

describe('aspect ids', () => {
  it('knows its ids and ratios', () => {
    expect(isAspectId('4:3')).toBe(true);
    expect(isAspectId('3:2')).toBe(false);
    expect(aspectRatio('original')).toBeNull();
    expect(aspectRatio('1:1')).toBe(1);
  });
});
