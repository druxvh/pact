import { describe, expect, it } from 'vitest';
import { AVATAR_BOX, avatarFileError, clampCrop, coverScale, sourceRect } from './avatarCrop';

describe('avatar crop geometry', () => {
  it('a wide image is scaled so its height fills the window', () => {
    expect(coverScale(2000, 1000)).toBeCloseTo(AVATAR_BOX / 1000);
    expect(coverScale(500, 1000)).toBeCloseTo(AVATAR_BOX / 500);
  });

  it('centred, un-zoomed crop is the largest centred square', () => {
    const r = sourceRect(2000, 1000, { zoom: 1, x: 0, y: 0 });
    expect(r.size).toBeCloseTo(1000);
    expect(r.sx).toBeCloseTo(500);
    expect(r.sy).toBeCloseTo(0);
  });

  it('zooming in shrinks the source square', () => {
    expect(sourceRect(1000, 1000, { zoom: 2, x: 0, y: 0 }).size).toBeCloseTo(500);
  });

  it('dragging cannot expose empty edges', () => {
    const c = clampCrop(1000, 1000, { zoom: 1, x: 999, y: -999 });
    expect(c).toEqual({ zoom: 1, x: 0, y: 0 }); // a square at 1× has no slack
    const w = clampCrop(2000, 1000, { zoom: 1, x: 9999, y: 0 });
    expect(w.x).toBeCloseTo((2 * AVATAR_BOX - AVATAR_BOX) / 2);
    const r = sourceRect(2000, 1000, { zoom: 1, x: 9999, y: 0 });
    expect(r.sx).toBeGreaterThanOrEqual(0);
    expect(r.sx + r.size).toBeLessThanOrEqual(2000 + 1e-6);
  });

  it('clamps zoom and survives garbage', () => {
    expect(clampCrop(1000, 1000, { zoom: 99, x: 0, y: 0 }).zoom).toBe(4);
    expect(clampCrop(1000, 1000, { zoom: Number.NaN, x: 0, y: 0 }).zoom).toBe(1);
  });

  it('only accepts real raster images of a sane size', () => {
    expect(avatarFileError({ type: 'image/png', size: 1000 })).toBeNull();
    expect(avatarFileError({ type: 'image/svg+xml', size: 1000 })).not.toBeNull();
    expect(avatarFileError({ type: 'application/pdf', size: 1000 })).not.toBeNull();
    expect(avatarFileError({ type: 'image/jpeg', size: 20 * 1024 * 1024 })).not.toBeNull();
  });
});
