import { describe, expect, it } from 'vitest';
import {
  ADJUST_MAX,
  ADJUST_MIN,
  applyPixelFilter,
  FILTER_IDS,
  FILTERS,
  filterById,
  isFilterId,
  isNeutralAdjust,
  NEUTRAL_ADJUST,
  opsFor,
  supportsCtxFilter,
  toCss,
} from '@/features/camera/filters';

const px = (...rgba: number[]) => new Uint8ClampedArray(rgba);
const run = (data: Uint8ClampedArray, ops: ReturnType<typeof opsFor>) => {
  applyPixelFilter(data, ops);
  return [...data];
};
const close = (actual: number[], expected: number[], tol = 1) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => {
    expect(Math.abs(v - (expected[i] as number)), `channel ${i}: ${v} vs ${expected[i]}`).toBeLessThanOrEqual(tol);
  });
};

describe('the filter list', () => {
  it('is the eight filters, in the order of the number keys 1–8', () => {
    expect(FILTER_IDS).toEqual(['none', 'mono', 'noir', 'warm', 'cool', 'vivid', 'fade', 'sepia']);
    expect(FILTERS).toHaveLength(8);
  });

  it('knows its own ids and falls back to None for an unknown one', () => {
    expect(isFilterId('noir')).toBe(true);
    expect(isFilterId('nope')).toBe(false);
    expect(isFilterId(3)).toBe(false);
    expect(filterById('nope' as never).id).toBe('none');
  });
});

describe('CSS filter strings (shared by the preview and the saved picture)', () => {
  it('None, with the sliders at 100 %, is no filter at all', () => {
    expect(opsFor('none')).toEqual([]);
    expect(toCss(opsFor('none'))).toBe('none');
  });

  it('is the filter followed by brightness / contrast when they have moved', () => {
    expect(toCss(opsFor('mono', { brightness: 120, contrast: 80 }))).toBe('grayscale(1) contrast(1.08) brightness(1.2) contrast(0.8)');
    expect(toCss(opsFor('none', { brightness: 100, contrast: 130 }))).toBe('contrast(1.3)');
  });

  it('keeps hue-rotate in degrees', () => {
    expect(toCss(opsFor('cool'))).toContain('hue-rotate(180deg)');
  });

  it('clamps wild slider values and ignores NaN', () => {
    expect(toCss(opsFor('none', { brightness: 900, contrast: 0 }))).toBe(`brightness(${ADJUST_MAX / 100}) contrast(${ADJUST_MIN / 100})`);
    expect(opsFor('none', { brightness: Number.NaN, contrast: 100 })).toEqual([]);
  });

  it('knows when the sliders are untouched', () => {
    expect(isNeutralAdjust(NEUTRAL_ADJUST)).toBe(true);
    expect(isNeutralAdjust({ brightness: 101, contrast: 100 })).toBe(false);
  });
});

describe('the pixel fallback (the CSS Filter Effects colour matrices)', () => {
  it('grayscale(1) turns pure red into its luminance', () => {
    close(run(px(255, 0, 0, 255), [{ fn: 'grayscale', value: 1 }]), [54, 54, 54, 255]);
  });

  it('grayscale(0) changes nothing', () => {
    close(run(px(10, 120, 240, 255), [{ fn: 'grayscale', value: 0 }]), [10, 120, 240, 255]);
  });

  it('sepia(1) of white is a warm white', () => {
    close(run(px(255, 255, 255, 255), [{ fn: 'sepia', value: 1 }]), [255, 255, 239, 255]);
  });

  it('saturate(0) is grayscale; saturate(1) is the identity', () => {
    close(run(px(255, 0, 0, 255), [{ fn: 'saturate', value: 0 }]), [54, 54, 54, 255]);
    close(run(px(30, 90, 200, 255), [{ fn: 'saturate', value: 1 }]), [30, 90, 200, 255]);
  });

  it('brightness scales and clamps', () => {
    close(run(px(200, 100, 50, 255), [{ fn: 'brightness', value: 0.5 }]), [100, 50, 25, 255]);
    close(run(px(200, 100, 50, 255), [{ fn: 'brightness', value: 2 }]), [255, 200, 100, 255]);
  });

  it('contrast pivots around mid-grey', () => {
    close(run(px(128, 128, 128, 255), [{ fn: 'contrast', value: 2 }]), [128, 128, 128, 255]);
    close(run(px(200, 100, 128, 255), [{ fn: 'contrast', value: 0 }]), [128, 128, 128, 255]);
    close(run(px(192, 64, 128, 255), [{ fn: 'contrast', value: 2 }]), [255, 0, 128, 255]);
  });

  it('hue-rotate(360) is the identity and two half-turns come back to the start', () => {
    close(run(px(100, 150, 200, 255), [{ fn: 'hue-rotate', value: 360 }]), [100, 150, 200, 255]);
    close(
      run(px(100, 150, 200, 255), [
        { fn: 'hue-rotate', value: 180 },
        { fn: 'hue-rotate', value: 180 },
      ]),
      [100, 150, 200, 255],
      2,
    );
  });

  it('never touches alpha', () => {
    const out = run(px(10, 20, 30, 77), opsFor('vivid'));
    expect(out[3]).toBe(77);
  });

  it('does nothing for an empty list', () => {
    expect(run(px(1, 2, 3, 4), [])).toEqual([1, 2, 3, 4]);
  });

  it('Noir and Mono are grey; Warm leans red and Cool leans blue', () => {
    const [nr, ng, nb] = run(px(180, 90, 40, 255), opsFor('noir'));
    expect(Math.abs((nr as number) - (ng as number))).toBeLessThanOrEqual(1);
    expect(Math.abs((ng as number) - (nb as number))).toBeLessThanOrEqual(1);
    const [mr, mg, mb] = run(px(60, 160, 220, 255), opsFor('mono'));
    expect(mr).toBe(mg);
    expect(mg).toBe(mb);
    const [wr, , wb] = run(px(128, 128, 128, 255), opsFor('warm'));
    expect(wr as number).toBeGreaterThan(wb as number);
    const [cr, , cb] = run(px(128, 128, 128, 255), opsFor('cool'));
    expect(cb as number).toBeGreaterThan(cr as number);
  });

  it('Vivid raises saturation and Fade lowers contrast', () => {
    const spread = (c: number[]) => Math.max(...c.slice(0, 3)) - Math.min(...c.slice(0, 3));
    const base = [200, 120, 80, 255];
    expect(spread(run(px(...base), opsFor('vivid')))).toBeGreaterThan(spread(base));
    expect(spread(run(px(...base), opsFor('fade')))).toBeLessThan(spread(base));
  });
});

describe('detecting native canvas filters', () => {
  it('is true when the context keeps what was assigned', () => {
    const ctx = { filter: 'none' };
    expect(supportsCtxFilter(ctx)).toBe(true);
    expect(ctx.filter).toBe('none');
  });

  it('is false when the property is missing, or accepted and ignored', () => {
    expect(supportsCtxFilter({})).toBe(false);
    expect(supportsCtxFilter(null)).toBe(false);
    const ignoring = {
      get filter() {
        return 'none';
      },
      set filter(_v: string) {},
    };
    expect(supportsCtxFilter(ignoring)).toBe(false);
  });
});
