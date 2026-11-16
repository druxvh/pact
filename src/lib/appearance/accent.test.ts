import { describe, expect, it } from 'vitest';
import { contrast, oklchToHex, parseHex, rgbToOklch } from '@/lib/oklch';
import { ACCENT_PRESETS, type AccentChoice, accentCss, baseColor, deriveAccent } from './accent';

const parseOklch = (s: string) => {
  const m = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)/.exec(s);
  if (!m) throw new Error(`not oklch: ${s}`);
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
};
const card = { light: { l: 1, c: 0, h: 0 }, dark: { l: 0.155, c: 0, h: 0 } };
const muted = { light: { l: 0.96, c: 0, h: 0 }, dark: { l: 0.22, c: 0, h: 0 } };

const choices: AccentChoice[] = [
  ...ACCENT_PRESETS.map((p): AccentChoice => ({ kind: 'preset', id: p.id })),
  ...['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ffffff', '#000000', '#123456', '#abcdef', '#808080'].map((hex): AccentChoice => ({ kind: 'custom', hex })),
];

describe('OKLCH conversions', () => {
  it('round-trips colours', () => {
    for (const hex of ['#ff6600', '#3366cc', '#00aa88', '#808080', '#ffffff', '#000000']) {
      expect(oklchToHex(rgbToOklch(parseHex(hex) as NonNullable<ReturnType<typeof parseHex>>)), hex).toBe(hex);
    }
  });
  it('knows black/white contrast', () => {
    expect(contrast({ l: 0, c: 0, h: 0 }, { l: 1, c: 0, h: 0 })).toBeCloseTo(21, 0);
  });
});

describe('accent derivation', () => {
  it('keeps the stock look untouched: the default orange emits no override', () => {
    expect(accentCss({ kind: 'preset', id: 'orange' })).toBe('');
  });

  for (const theme of ['light', 'dark'] as const) {
    it(`every preset and a spread of custom colours stays legible in ${theme} theme`, () => {
      for (const choice of choices) {
        const label = choice.kind === 'preset' ? choice.id : choice.hex;
        const t = deriveAccent(baseColor(choice, theme), theme);
        const brand = parseOklch(t['--brand']);
        // ink on brand-coloured buttons
        expect(contrast(parseOklch(t['--brand-foreground']), brand), `ink on ${label}`).toBeGreaterThanOrEqual(4.5);
        // brand-coloured text on cards and on muted surfaces
        const text = parseOklch(t['--brand-text']);
        expect(contrast(text, card[theme]), `text on card ${label}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(text, muted[theme]), `text on muted ${label}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('emits both theme blocks with every token', () => {
    const css = accentCss({ kind: 'preset', id: 'blue' });
    expect(css).toMatch(/^html:root\{/);
    expect(css).toContain('html.dark{');
    for (const token of ['--brand', '--brand-foreground', '--brand-text', '--brand-soft', '--brand-glow', '--ring']) {
      expect(css.split(`${token}:`).length - 1, token).toBe(2);
    }
  });

  it('picks dark ink for pale accents and light ink for deep ones', () => {
    const yellow = deriveAccent(baseColor({ kind: 'preset', id: 'yellow' }, 'light'), 'light');
    const indigo = deriveAccent({ l: 0.5, c: 0.2, h: 270 }, 'light');
    expect(parseOklch(yellow['--brand-foreground']).l).toBeLessThan(0.3);
    expect(parseOklch(indigo['--brand-foreground']).l).toBeGreaterThan(0.9);
  });

  it('clamps a custom colour that is too light or too dark to be a button colour', () => {
    expect(baseColor({ kind: 'custom', hex: '#ffffff' }, 'light').l).toBeLessThanOrEqual(0.84);
    expect(baseColor({ kind: 'custom', hex: '#000000' }, 'light').l).toBeGreaterThanOrEqual(0.5);
  });

  it('falls back to the default for an unusable custom value', () => {
    expect(baseColor({ kind: 'custom', hex: 'nonsense' }, 'light').h).toBeCloseTo(47.6, 1);
  });

  it('graphite flips between themes (dark button on light, light button on dark)', () => {
    const g = { kind: 'preset', id: 'graphite' } as const;
    expect(baseColor(g, 'light').l).toBeLessThan(0.4);
    expect(baseColor(g, 'dark').l).toBeGreaterThan(0.85);
  });
});
