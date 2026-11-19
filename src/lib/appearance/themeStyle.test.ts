import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { contrast, type Oklch, oklchToRgb, parseHex, rgbToOklch } from '@/lib/oklch';
import { APPEARANCE_DEFAULTS } from '@/store/useAppearanceStore';
import { baseColor, deriveAccent } from './accent';
import { appearanceCss, applyAppearance, BOOT_KEY } from './apply';
import { fontById } from './fonts';
import { RADIUS_IDS } from './radius';
import {
  coerceThemeStyle,
  DEFAULT_THEME_STYLE,
  DOT_MATRIX_RED,
  isThemeStyleId,
  styleBundle,
  styleCss,
  THEME_STYLE_IDS,
  THEME_STYLES,
  themeStyleById,
} from './themeStyle';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const dotCss = read('../../styles/dotmatrix.css');

/** The custom properties declared in the block that starts with `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = dotCss.indexOf(`${selector} {`);
  expect(start, `block ${selector}`).toBeGreaterThanOrEqual(0);
  const body = dotCss.slice(dotCss.indexOf('{', start) + 1, dotCss.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));
}
const LIGHT = tokens("html[data-style='dotmatrix']:root");
const DARK = tokens("html.dark[data-style='dotmatrix']");
const ink = (hex: string): Oklch => rgbToOklch(parseHex(hex) as NonNullable<ReturnType<typeof parseHex>>);
const hex = (t: Record<string, string>, k: string) => {
  const v = t[k];
  expect(v, k).toMatch(/^#[0-9a-f]{6}$/i);
  return v as string;
};

describe('theme style registry', () => {
  it('lists every id once, Default first, each with a label and a description', () => {
    expect(THEME_STYLES.map((s) => s.id)).toEqual([...THEME_STYLE_IDS]);
    expect(new Set(THEME_STYLE_IDS).size).toBe(THEME_STYLE_IDS.length);
    expect(DEFAULT_THEME_STYLE).toBe('default');
    expect(THEME_STYLE_IDS[0]).toBe('default');
    for (const s of THEME_STYLES) {
      expect(s.label.length, s.id).toBeGreaterThan(1);
      expect(s.description.length, s.id).toBeGreaterThan(10);
    }
  });

  it('names Dot Matrix in exactly one place', () => {
    const dm = themeStyleById('dotmatrix');
    expect(dm.label).toBe('Dot Matrix');
    expect(dm.description).toBe('Black, white and one red dot. Inspired by Nothing’s design language.');
    // the label never leaks anywhere else in the style plumbing: nothing else spells it out
    for (const f of ['apply.ts', 'themeStyle.ts', '../../store/useAppearanceStore.ts', '../../features/settings/StylePicker.tsx']) {
      const text = read(f);
      const hits = text.match(/Dot Matrix/g)?.length ?? 0;
      expect(hits, f).toBe(f === 'themeStyle.ts' ? 1 : 0);
    }
  });

  it('Default’s bundle is exactly the stock look, so picking it restores it', () => {
    const b = styleBundle('default');
    expect(b).toEqual({
      accent: APPEARANCE_DEFAULTS.accent,
      font: APPEARANCE_DEFAULTS.font,
      monoFont: APPEARANCE_DEFAULTS.monoFont,
      radius: APPEARANCE_DEFAULTS.radius,
    });
    expect(styleCss('default')).toBe('');
    expect(themeStyleById('default').fonts).toEqual([]);
  });

  it('every bundle refers to real things: fonts that exist in the right slot, a known roundness, a valid accent', () => {
    for (const s of THEME_STYLES) {
      const sans = fontById(s.bundle.font);
      const mono = fontById(s.bundle.monoFont);
      expect(sans, `${s.id} interface font`).toBeDefined();
      // a style may set a monospace interface font; the Font picker still lists only sans / serif / system by default
      expect(['sans', 'serif', 'system', 'mono'], `${s.id} interface font category`).toContain(sans?.category);
      expect(mono?.category, `${s.id} code font`).toBe('mono');
      expect(RADIUS_IDS as readonly string[], s.id).toContain(s.bundle.radius);
      if (s.bundle.accent.kind === 'custom') expect(s.bundle.accent.hex).toMatch(/^#[0-9a-f]{6}$/i);
      for (const f of s.fonts) expect(fontById(f)?.category, `${s.id} display font ${f}`).toBe('display');
    }
  });

  it('Dot Matrix: signal red accent, Space Grotesk + Space Mono, Doto for display, small corners', () => {
    const dm = themeStyleById('dotmatrix');
    expect(dm.bundle).toEqual({ accent: { kind: 'custom', hex: DOT_MATRIX_RED }, font: 'space-grotesk', monoFont: 'space-mono', radius: 'sm' });
    expect(DOT_MATRIX_RED).toBe('#D71921');
    expect(dm.fonts).toEqual(['doto']);
    expect(dm.preview.texture).toBe('dots');
  });

  it('styleBundle hands out copies, never the registry’s own object', () => {
    const a = styleBundle('dotmatrix');
    a.radius = 'lg';
    expect(styleBundle('dotmatrix').radius).toBe('sm');
  });
});

describe('coerceThemeStyle', () => {
  it('accepts the known ids and falls back to Default for anything else', () => {
    for (const id of THEME_STYLE_IDS) expect(coerceThemeStyle(id)).toBe(id);
    for (const bad of [undefined, null, 'neon', 'DOTMATRIX', 7, {}, ['dotmatrix'], '']) expect(coerceThemeStyle(bad)).toBe('default');
    expect(isThemeStyleId('dotmatrix')).toBe(true);
    expect(isThemeStyleId('retro')).toBe(false);
    expect(themeStyleById('retro').id).toBe('default');
  });
});

describe('style CSS in the appearance pipeline', () => {
  const base = {
    accent: { kind: 'preset', id: 'orange' } as const,
    font: 'geist',
    monoFont: 'geist-mono',
    radius: 'md' as const,
    wallpaper: { kind: 'none' } as const,
    dim: { light: 0, dark: 0 },
  };

  it('Default adds nothing (so the stock look and the boot cache are untouched)', () => {
    expect(appearanceCss({ ...base, style: 'default' })).toBe('');
  });

  it('Dot Matrix hands the CSS layer its display font through a variable', () => {
    const css = styleCss('dotmatrix');
    expect(css).toContain("--pact-font-display:'Doto Variable'");
    expect(appearanceCss({ ...base, style: 'dotmatrix' })).toContain(css);
  });

  it('an unknown style never reaches the stylesheet', () => {
    expect(appearanceCss({ ...base, style: 'evil{}' as never })).toBe('');
  });
});

describe('applying a style (first paint)', () => {
  const snap = { ...APPEARANCE_DEFAULTS };
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.style;
  });

  it('writes data-style on <html> and into the boot cache, and removes both for Default', () => {
    applyAppearance({ ...snap, style: 'dotmatrix', accent: { kind: 'custom', hex: DOT_MATRIX_RED } });
    expect(document.documentElement.dataset.style).toBe('dotmatrix');
    const boot = JSON.parse(localStorage.getItem(BOOT_KEY) ?? '{}');
    expect(boot.style).toBe('dotmatrix');
    expect(boot.css).toContain('--pact-font-display');
    expect(boot.css).toContain('--brand:'); // the red accent comes along

    applyAppearance({ ...snap, style: 'default' });
    expect(document.documentElement.dataset.style).toBeUndefined();
    expect(JSON.parse(localStorage.getItem(BOOT_KEY) ?? '{}').style).toBeUndefined();
  });

  it('public/theme-init.js puts the cached style on <html> before anything paints', () => {
    const script = readFileSync(resolve(__dirname, '../../../public/theme-init.js'), 'utf8');
    localStorage.setItem(BOOT_KEY, JSON.stringify({ css: 'html:root{--brand:red}', mode: '', fonts: '', style: 'dotmatrix' }));
    new Function(script)();
    expect(document.documentElement.dataset.style).toBe('dotmatrix');
    delete document.documentElement.dataset.style;
    localStorage.setItem(BOOT_KEY, JSON.stringify({ css: '', mode: '' }));
    new Function(script)();
    expect(document.documentElement.dataset.style).toBeUndefined();
    document.getElementById('pact-appearance')?.remove();
  });
});

describe('Dot Matrix palette (styles/dotmatrix.css)', () => {
  const SURFACES = ['--background', '--card', '--popover', '--muted', '--secondary'];
  const INKS = ['--foreground', '--card-foreground', '--popover-foreground', '--secondary-foreground', '--muted-foreground', '--subtle-foreground'];
  const STATUS_TEXT = ['--success-text', '--warning-text', '--destructive-text'];

  it('dark only re-declares tokens light has (it never invents one), and both define every surface, ink and status token', () => {
    for (const k of Object.keys(DARK)) expect(Object.keys(LIGHT), k).toContain(k);
    for (const k of [...SURFACES, ...INKS, ...STATUS_TEXT, '--border', '--input', '--accent', '--dm-dot']) {
      expect(Object.keys(LIGHT), `light ${k}`).toContain(k);
      expect(Object.keys(DARK), `dark ${k}`).toContain(k);
    }
  });

  for (const [name, t] of [
    ['light', LIGHT],
    ['dark', DARK],
  ] as const) {
    it(`${name}: text stays ≥ 4.5:1 on every surface (ink, muted, subtle, status text)`, () => {
      for (const k of [...INKS, ...STATUS_TEXT]) {
        for (const s of SURFACES) expect(contrast(ink(hex(t, k)), ink(hex(t, s))), `${name} ${k} on ${s}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${name}: the signal red as TEXT goes through the same text-safe adaptation as any accent (≥ 4.5:1 on every surface), and white ink on the red dot reads`, () => {
      const choice = themeStyleById('dotmatrix').bundle.accent;
      const t2 = deriveAccent(baseColor(choice, name), name);
      const parse = (s: string): Oklch => {
        const m = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)/.exec(s) as RegExpExecArray;
        return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
      };
      for (const s of SURFACES) expect(contrast(parse(t2['--brand-text']), ink(hex(t, s))), `${name} brand text on ${s}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(parse(t2['--brand-foreground']), parse(t2['--brand']))).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: red text on the soft red tint (selected tab, soft button, icon tile) stays ≥ 4.5:1 on every surface`, () => {
      const choice = themeStyleById('dotmatrix').bundle.accent;
      const t2 = deriveAccent(baseColor(choice, name), name);
      const parse = (s: string): Oklch => {
        const m = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)/.exec(s) as RegExpExecArray;
        return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
      };
      const pct = Number(/var\(--brand\) ([\d.]+)%/.exec(t['--brand-soft'] ?? '')?.[1]) / 100;
      expect(pct, '--brand-soft is a percentage of --brand').toBeGreaterThan(0);
      const brand = oklchToRgb(parse(t2['--brand']));
      for (const s of SURFACES) {
        const surface = parseHex(hex(t, s)) as NonNullable<ReturnType<typeof parseHex>>;
        const mix = (a: number, b: number) => Math.round(a * (1 - pct) + b * pct);
        const tinted = rgbToOklch({ r: mix(surface.r, brand.r), g: mix(surface.g, brand.g), b: mix(surface.b, brand.b) });
        expect(contrast(parse(t2['--brand-text']), tinted), `${name} brand text on soft tint over ${s}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${name}: flat — no shadows, glow or ambient wash`, () => {
      for (const k of ['--elev-1', '--elev-2', '--elev-3', '--elev-pop', '--elev-brand']) expect(t[k], `${name} ${k}`).toBe('0 0 #0000');
      expect(t['--ambient-1']).toBe('transparent');
      expect(t['--ambient-2']).toBe('transparent');
    });
  }

  it('black and white: surfaces and ink are neutral greys (the red is the only colour)', () => {
    for (const t of [LIGHT, DARK]) {
      for (const k of [...SURFACES, ...INKS]) expect(ink(hex(t, k)).c, k).toBeLessThan(0.002);
    }
    // dark is "black", light is "off-white"
    expect(ink(hex(DARK, '--background')).l).toBeLessThan(0.12);
    expect(ink(hex(LIGHT, '--background')).l).toBeGreaterThan(0.95);
  });

  it('the picker preview draws the same palette as the CSS (so the card shows what you get)', () => {
    const { preview } = themeStyleById('dotmatrix');
    for (const [p, t] of [
      [preview.light, LIGHT],
      [preview.dark, DARK],
    ] as const) {
      expect(p.bg).toBe(t['--background']);
      expect(p.card).toBe(t['--card']);
      expect(p.ink).toBe(t['--foreground']);
      expect(p.muted).toBe(t['--muted-foreground']);
    }
  });

  it('only ever uses the red as a fill or through --brand-text, never as bare text colour', () => {
    // any `color:` in the style layer must be a token, not a literal
    for (const m of dotCss.matchAll(/(?<![-\w])color:\s*([^;]+);/g)) expect(m[1], 'color value').toMatch(/^var\(/);
  });

  it('keeps the logo, avatars and timer ring hooks the components expose', () => {
    expect(dotCss).toContain('[data-logo]');
    expect(dotCss).toContain('[data-display]');
    expect(dotCss).toContain('#timer-ring');
    expect(dotCss).toContain('[data-glow]');
  });
});
