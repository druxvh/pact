import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appearanceCss } from './apply';
import { coerceRadius, DEFAULT_RADIUS, isRadiusId, RADIUS_IDS, RADIUS_SCALE, radiusCss } from './radius';

const css = readFileSync(resolve(__dirname, '../../styles/globals.css'), 'utf8');

describe('radiusCss', () => {
  it('adds nothing for the stock look, so existing users see no change', () => {
    expect(DEFAULT_RADIUS).toBe('md');
    expect(radiusCss('md')).toBe('');
  });

  it('flattens every corner for “none” and emits all four steps for the others', () => {
    expect(radiusCss('none')).toBe('html:root{--radius:0px;--radius-xs:0px;--radius-sm:0px;--radius-md:0px;--radius-lg:0px}');
    expect(radiusCss('sm')).toBe('html:root{--radius:4px;--radius-xs:1px;--radius-sm:2px;--radius-md:3px;--radius-lg:4px}');
    expect(radiusCss('lg')).toBe('html:root{--radius:16px;--radius-xs:6px;--radius-sm:9px;--radius-md:12px;--radius-lg:16px}');
  });

  it('keeps `--radius` (used by prose and the xl…3xl aliases) in step with `lg`', () => {
    for (const id of RADIUS_IDS.filter((i) => i !== 'md')) expect(radiusCss(id)).toContain(`--radius:${RADIUS_SCALE[id].lg}px;`);
  });

  it('never makes an inner corner rounder than the one around it', () => {
    for (const id of RADIUS_IDS) {
      const s = RADIUS_SCALE[id];
      expect(s.xs, id).toBeLessThanOrEqual(s.sm);
      expect(s.sm, id).toBeLessThanOrEqual(s.md);
      expect(s.md, id).toBeLessThanOrEqual(s.lg);
    }
  });

  it('gets rounder with every step', () => {
    for (const [a, b] of [
      ['none', 'sm'],
      ['sm', 'md'],
      ['md', 'lg'],
    ] as const) {
      expect(RADIUS_SCALE[a].lg).toBeLessThan(RADIUS_SCALE[b].lg);
      expect(RADIUS_SCALE[a].md).toBeLessThan(RADIUS_SCALE[b].md);
    }
  });

  it('the stock step equals the theme in globals.css, so “Medium” is exactly the look everyone already had', () => {
    const base = Number(/--radius:\s*([\d.]+)rem/.exec(css)?.[1]) * 16;
    const minus = (name: string) => Number(new RegExp(`--radius-${name}:\\s*calc\\(var\\(--radius\\) - (\\d+)px\\)`).exec(css)?.[1]);
    expect(base).toBe(10);
    expect(RADIUS_SCALE.md).toEqual({ xs: base - minus('xs'), sm: base - minus('sm'), md: base - minus('md'), lg: base });
  });

  it('is part of the generated appearance stylesheet (and therefore of the first-paint cache)', () => {
    const base = {
      style: 'default' as const,
      accent: { kind: 'preset', id: 'orange' } as const,
      font: 'geist',
      monoFont: 'geist-mono',
      wallpaper: { kind: 'none' } as const,
      dim: { light: 0, dark: 0 },
    };
    expect(appearanceCss({ ...base, radius: 'md' })).toBe('');
    expect(appearanceCss({ ...base, radius: 'none' })).toContain('--radius-md:0px');
    expect(appearanceCss({ ...base, radius: 'lg' })).toContain('--radius-lg:16px');
  });
});

describe('coerceRadius', () => {
  it('accepts the four ids and falls back to medium for anything else', () => {
    for (const id of RADIUS_IDS) expect(coerceRadius(id)).toBe(id);
    for (const bad of [undefined, null, 'xl', 'MD', 4, {}, ['lg']]) expect(coerceRadius(bad)).toBe('md');
    expect(isRadiusId('none')).toBe(true);
    expect(isRadiusId('xl')).toBe(false);
  });
});
