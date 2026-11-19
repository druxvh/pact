import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { armillaryPlateSvg, bannerPlateSvg, grainTileSvg, haloPlateSvg, PLATE, rng, svgUrl, ultramarinePlatesCss } from '@/features/ultramarine/plates';
import { contrast, type Oklch, oklchToRgb, parseHex, rgbToOklch } from '@/lib/oklch';
import { baseColor, deriveAccent } from './accent';
import { appearanceCss } from './apply';
import { fontById, interfaceFonts, monoFonts } from './fonts';
import { coerceThemeStyle, styleBundle, styleCss, styleSurfaces, themeStyleById, ULTRAMARINE_BLUE } from './themeStyle';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const css = read('../../styles/ultramarine.css');
const plates = read('../../styles/ultramarine-plates.css');

/** The custom properties declared in the block that starts with `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `block ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));
}
const LIGHT = tokens("html[data-style='ultramarine']:root");
const DARK = tokens("html.dark[data-style='ultramarine']");
const ink = (hex: string): Oklch => rgbToOklch(parseHex(hex) as NonNullable<ReturnType<typeof parseHex>>);
const hex = (t: Record<string, string>, k: string) => {
  const v = t[k];
  expect(v, k).toMatch(/^#[0-9a-f]{6}$/i);
  return v as string;
};
const parseOklch = (s: string): Oklch => {
  const m = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)/.exec(s) as RegExpExecArray;
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
};

const SURFACES = ['--background', '--card', '--popover', '--muted', '--secondary'];
const INKS = ['--foreground', '--card-foreground', '--popover-foreground', '--secondary-foreground', '--muted-foreground', '--subtle-foreground'];
const STATUS_TEXT = ['--success-text', '--warning-text', '--destructive-text'];

describe('Ultramarine: the registry entry', () => {
  const um = themeStyleById('ultramarine');

  it('is ink-navy and one electric blue, in Mona Sans over JetBrains Mono, with Oswald for display and square corners', () => {
    expect(um.label).toBe('Ultramarine');
    expect(um.bundle).toEqual({ accent: { kind: 'custom', hex: ULTRAMARINE_BLUE }, font: 'mona-sans', monoFont: 'jetbrains-mono', radius: 'none' });
    expect(ULTRAMARINE_BLUE).toBe('#3A3AFF');
    expect(um.fonts).toEqual(['oswald']);
    expect(um.preview.art).toBe('halo');
    expect(um.preview.displayFont).toBe('oswald');
    expect(um.description.length).toBeGreaterThan(20);
  });

  it('the accent is already as light as the pipeline keeps an accent (≥ 0.5), so the swatch you see is the fill you get', () => {
    expect(ink(ULTRAMARINE_BLUE).l).toBeGreaterThanOrEqual(0.5);
    const base = baseColor(um.bundle.accent, 'dark');
    const wanted = ink(ULTRAMARINE_BLUE);
    expect(Math.abs(base.l - wanted.l)).toBeLessThan(0.004);
    expect(Math.abs(base.h - wanted.h)).toBeLessThan(1);
  });

  it('Oswald is a display face (bundled for the style, never offered as the interface or code font); Mona Sans is an ordinary sans', () => {
    expect(fontById('oswald')?.category).toBe('display');
    expect(interfaceFonts().some((f) => f.id === 'oswald')).toBe(false);
    expect(monoFonts().some((f) => f.id === 'oswald')).toBe(false);
    expect(fontById('mona-sans')?.category).toBe('sans');
    expect(interfaceFonts().some((f) => f.id === 'mona-sans')).toBe(true);
    // while loading, the display face falls back to a sans (not the monospace the dot-matrix faces use)
    expect(styleCss('ultramarine')).toContain("--pact-font-display:'Oswald Variable', ui-sans-serif");
  });

  it('a stored “stoic” (the style this replaced) opens as Ultramarine, an old “terminal” as Dusk, and nothing else changes', () => {
    expect(coerceThemeStyle('stoic')).toBe('ultramarine');
    expect(coerceThemeStyle('terminal')).toBe('dusk');
    expect(coerceThemeStyle('ultramarine')).toBe('ultramarine');
    expect(coerceThemeStyle('Stoic')).toBe('default');
    expect(coerceThemeStyle('constructor')).toBe('default');
  });

  it('the registry’s surfaces and the picker preview are the CSS tokens (so the card shows what you get)', () => {
    expect(um.surfaces?.light).toEqual(SURFACES.map((k) => hex(LIGHT, k)));
    expect(um.surfaces?.dark).toEqual(SURFACES.map((k) => hex(DARK, k)));
    for (const [p, t] of [
      [um.preview.light, LIGHT],
      [um.preview.dark, DARK],
    ] as const) {
      expect(p.bg).toBe(t['--background']);
      expect(p.card).toBe(t['--card']);
      expect(p.ink).toBe(t['--foreground']);
      expect(p.muted).toBe(t['--muted-foreground']);
    }
  });

  it('the accent pipeline is handed the navy and paper surfaces, not the stock ones', () => {
    const s = styleSurfaces('ultramarine');
    expect(s?.light).toHaveLength(5);
    expect(s?.dark).toHaveLength(5);
    const out = appearanceCss({ style: 'ultramarine', ...styleBundle('ultramarine'), wallpaper: { kind: 'none' }, dim: { light: 0, dark: 0 } });
    expect(out).toContain('--brand-text:');
    expect(out).toContain('html.dark{');
    expect(out).toContain('--pact-font-display');
  });
});

describe('Ultramarine palette (styles/ultramarine.css)', () => {
  it('dark only re-declares tokens light has (it never invents one), and both define every surface, ink and status token', () => {
    const lightOnly = ['--sw-card', '--sw-blur', '--sw-scrim', '--sw-scrim-edge', '--um-cobalt', '--um-plate-bright'];
    for (const k of Object.keys(DARK)) expect(Object.keys(LIGHT), k).toContain(k);
    for (const k of [
      ...SURFACES,
      ...INKS,
      ...STATUS_TEXT,
      '--border',
      '--input',
      '--accent',
      '--um-rule',
      '--um-primary-bg',
      '--um-primary-ink',
      '--elev-pop',
    ]) {
      expect(Object.keys(LIGHT), `light ${k}`).toContain(k);
      expect(Object.keys(DARK), `dark ${k}`).toContain(k);
    }
    for (const k of lightOnly) expect(Object.keys(LIGHT), k).toContain(k);
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

    it(`${name}: the accent as TEXT (--brand-text) stays ≥ 4.5:1 on every surface, and ink on the accent fill reads`, () => {
      const choice = themeStyleById('ultramarine').bundle.accent;
      const surfaces = styleSurfaces('ultramarine') as NonNullable<ReturnType<typeof styleSurfaces>>;
      const out = deriveAccent(baseColor(choice, name), name, surfaces[name]);
      for (const s of SURFACES) expect(contrast(parseOklch(out['--brand-text']), ink(hex(t, s))), `${name} brand text on ${s}`).toBeGreaterThanOrEqual(4.5);
      // white on cobalt: the selected tab, the highlighted menu row, the badge
      expect(contrast(parseOklch(out['--brand-foreground']), parseOklch(out['--brand']))).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: accent text on its soft tint (soft button, icon tile) stays ≥ 4.5:1 on every surface`, () => {
      const choice = themeStyleById('ultramarine').bundle.accent;
      const surfaces = styleSurfaces('ultramarine') as NonNullable<ReturnType<typeof styleSurfaces>>;
      const out = deriveAccent(baseColor(choice, name), name, surfaces[name]);
      const pct = Number(/var\(--brand\) ([\d.]+)%/.exec(t['--brand-soft'] ?? '')?.[1]) / 100;
      expect(pct, '--brand-soft is a percentage of --brand').toBeGreaterThan(0);
      const brand = oklchToRgb(parseOklch(out['--brand']));
      for (const s of SURFACES) {
        const surface = parseHex(hex(t, s)) as NonNullable<ReturnType<typeof parseHex>>;
        const mix = (a: number, b: number) => Math.round(a * (1 - pct) + b * pct);
        const tinted = rgbToOklch({ r: mix(surface.r, brand.r), g: mix(surface.g, brand.g), b: mix(surface.b, brand.b) });
        expect(contrast(parseOklch(out['--brand-text']), tinted), `${name} brand text on soft tint over ${s}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${name}: flat — every elevation is "none" and there is no ambient wash`, () => {
      for (const k of ['--elev-1', '--elev-2', '--elev-3', '--elev-pop', '--elev-brand']) expect(t[k], `${name} ${k}`).toBe('0 0 #0000');
      expect(t['--ambient-1']).toBe('transparent');
      expect(t['--ambient-2']).toBe('transparent');
    });
  }

  it('the primary button reads: in dark a white block with deepened-accent text, in light the accent with its own ink', () => {
    const surfaces = styleSurfaces('ultramarine') as NonNullable<ReturnType<typeof styleSurfaces>>;
    const choice = themeStyleById('ultramarine').bundle.accent;
    // dark: --um-primary-bg is a literal white-ish; the ink is `oklch(from var(--brand) min(l, 0.44) c h)`
    expect(DARK['--um-primary-ink']).toBe('oklch(from var(--brand) min(l, 0.44) c h)');
    const brandDark = deriveAccent(baseColor(choice, 'dark'), 'dark', surfaces.dark);
    const b = parseOklch(brandDark['--brand']);
    const inkOnWhite: Oklch = { l: Math.min(b.l, 0.44), c: b.c, h: b.h };
    for (const bg of [hex(DARK, '--um-primary-bg'), hex(DARK, '--um-primary-hover')])
      expect(contrast(inkOnWhite, ink(bg)), `button ink on ${bg}`).toBeGreaterThanOrEqual(7);
    // light: --um-primary-bg is the accent itself, so the ink is the pipeline's --brand-foreground (checked above)
    expect(LIGHT['--um-primary-bg']).toBe('var(--brand)');
    expect(LIGHT['--um-primary-ink']).toBe('var(--brand-foreground)');
  });

  it('cool, not beige: paper and ink lean blue (hue 260–300), navy is near-black, paper near-white', () => {
    for (const k of SURFACES) {
      expect(ink(hex(LIGHT, k)).h, `light ${k}`).toBeGreaterThan(255);
      expect(ink(hex(LIGHT, k)).h, `light ${k}`).toBeLessThan(305);
      expect(ink(hex(DARK, k)).h, `dark ${k}`).toBeGreaterThan(255);
      expect(ink(hex(DARK, k)).h, `dark ${k}`).toBeLessThan(305);
    }
    expect(ink(hex(DARK, '--background')).l).toBeLessThan(0.2);
    expect(ink(hex(LIGHT, '--background')).l).toBeGreaterThan(0.92);
    expect(ink(hex(DARK, '--foreground')).l).toBeGreaterThan(0.94);
  });

  it('the dark surfaces step up in lightness: page < card < popover < muted < secondary', () => {
    const ls = SURFACES.map((k) => ink(hex(DARK, k)).l);
    expect(ls).toEqual([...ls].sort((a, b) => a - b));
  });

  it('only ever sets colour from a token (a literal would not follow light/dark or the accent)', () => {
    for (const m of css.matchAll(/(?<![-\w])color:\s*([^;]+);/g)) expect(m[1], 'color value').toMatch(/^(var\(|inherit$)/);
  });

  it('is flat: no blurs or glows, no text-shadow, no drop shadow with a blur radius', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/(?<!-)blur\(\s*\d/);
    expect(code).not.toMatch(/text-shadow\s*:/);
    expect(code).not.toMatch(/box-shadow:[^;]*\b\d+px \d+px [1-9]\d*px/); // no blur radius in a shadow
  });

  it('keys everything on the style (the exceptions are the hooks that must exist in every style)', () => {
    const unkeyed = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => /^[^\s@}].*\{$/.test(l) && !l.includes("[data-style='ultramarine']"))
      .map((l) => l.trim());
    for (const sel of unkeyed) expect(sel, 'unkeyed selector').toMatch(/^(\[data-cardinals\]|to \{|from \{)/);
  });

  it('keeps the hooks the components expose', () => {
    for (const hook of [
      '[data-logo]',
      '[data-display]',
      '[data-colon]',
      '[data-page-header]',
      '[data-cardinals]',
      '[data-variant',
      "[role='tablist']",
      "[role='switch']",
    ]) {
      expect(css, hook).toContain(hook);
    }
  });

  it('draws the window frame in the accent over everything, never catching a click', () => {
    expect(css).toMatch(/body::after\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/body::after\s*\{[^}]*inset 0 0 0 3px var\(--brand\)/);
  });

  it('respects reduced motion: the OS setting is globals.css’s, the in-app one is switched on in this file', () => {
    expect(read('../../styles/globals.css')).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain("[data-motion='reduced']");
  });

  it('lets the wallpaper through its cards by --sw-card, 90 % by default, with no blur (so text keeps its contrast)', () => {
    expect(LIGHT['--sw-card']).toBe('90%');
    expect(LIGHT['--sw-blur']).toBe('0px');
    // type on a 90 % card over the darkest/lightest the scene can be: the worst case is the card itself at 90 % over the opposite extreme
    for (const [name, t, far] of [
      ['dark', DARK, '#6a6aff'],
      ['light', LIGHT, '#0d0d24'],
    ] as const) {
      const card = parseHex(hex(t, '--card')) as NonNullable<ReturnType<typeof parseHex>>;
      const behind = parseHex(far) as NonNullable<ReturnType<typeof parseHex>>;
      const mix = (a: number, b: number) => Math.round(a * 0.9 + b * 0.1);
      const seen = rgbToOklch({ r: mix(card.r, behind.r), g: mix(card.g, behind.g), b: mix(card.b, behind.b) });
      for (const k of INKS) expect(contrast(ink(hex(t, k)), seen), `${name} ${k} on a 90% card over ${far}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('engraved plates (features/ultramarine/plates.ts)', () => {
  it('the generator is seeded: the same call makes the same bytes, a different seed a different picture', () => {
    expect(haloPlateSvg()).toBe(haloPlateSvg());
    expect(armillaryPlateSvg()).toBe(armillaryPlateSvg());
    expect(haloPlateSvg()).not.toBe(armillaryPlateSvg());
    const a = rng(1);
    const b = rng(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(rng(2)()).not.toBe(rng(1)());
  });

  it('a plate is cobalt ground with lavender hairlines — a few KB of paths, no raster, no script, no external reference', () => {
    for (const svg of [haloPlateSvg(), armillaryPlateSvg(), bannerPlateSvg()]) {
      expect(svg.startsWith("<svg xmlns='http://www.w3.org/2000/svg'")).toBe(true);
      expect(svg).toContain(`fill='${PLATE.ground}'`);
      expect(svg).toContain(`stroke='${PLATE.ink}'`);
      expect(svg).not.toMatch(/<image|<script|href=|url\(|<filter|<foreignObject/i);
      expect(svg.length).toBeLessThan(14_000);
    }
    expect(contrast(ink(PLATE.ink), ink(PLATE.ground))).toBeGreaterThanOrEqual(4.5);
    expect(ink(PLATE.ground).l).toBeLessThan(0.5);
  });

  it('the cobalt behind a cover photo is the plates’ own ground, so a photo and an engraving sit side by side as one colour', () => {
    expect(LIGHT['--um-cobalt']).toBe(PLATE.ground);
  });

  it('a plate is square, or a strip (the banner is 352 × 64)', () => {
    expect(haloPlateSvg(96)).toContain("width='96' height='96' viewBox='0 0 96 96'");
    expect(bannerPlateSvg()).toContain("width='352' height='64' viewBox='0 0 352 64'");
    expect(armillaryPlateSvg(64)).toContain("viewBox='0 0 64 64'");
  });

  it('svgUrl yields a data URL with nothing that breaks a CSS url("…")', () => {
    for (const svg of [haloPlateSvg(), armillaryPlateSvg(), bannerPlateSvg(), grainTileSvg()]) {
      const u = svgUrl(svg);
      expect(u.startsWith('url("data:image/svg+xml,')).toBe(true);
      expect(u.slice(5, -2)).not.toMatch(/["<>#]/);
    }
  });

  it('styles/ultramarine-plates.css is the generator’s output (run `bun scripts/gen-ultramarine-plates.ts` after changing plates.ts)', () => {
    expect(plates).toBe(ultramarinePlatesCss());
    for (const v of ['--um-plate-halo', '--um-plate-armillary', '--um-plate-banner', '--um-grain']) expect(plates, v).toContain(`${v}:`);
    expect(plates.length, 'the generated sheet stays small').toBeLessThan(40_000);
  });
});

describe('opening a store that holds a retired style', () => {
  async function loadStore() {
    vi.resetModules();
    return (await import('@/store/useAppearanceStore')).useAppearanceStore;
  }
  beforeEach(() => localStorage.clear());

  it('a stored Stoic opens as Ultramarine with Ultramarine’s own accent, fonts and corners — not Stoic’s red and serif', async () => {
    localStorage.setItem(
      'pact-appearance',
      JSON.stringify({
        state: { style: 'stoic', accent: { kind: 'custom', hex: '#A8402A' }, font: 'source-serif-4', monoFont: 'ibm-plex-mono', radius: 'none' },
        version: 4,
      }),
    );
    const s = (await loadStore()).getState();
    expect(s.style).toBe('ultramarine');
    expect(s.accent).toEqual({ kind: 'custom', hex: ULTRAMARINE_BLUE });
    expect(s.font).toBe('mona-sans');
    expect(s.monoFont).toBe('jetbrains-mono');
  });

  it('a stored Ultramarine keeps what the user changed afterwards (the bundle is applied on picking, not on every start)', async () => {
    localStorage.setItem(
      'pact-appearance',
      JSON.stringify({
        state: { style: 'ultramarine', accent: { kind: 'preset', id: 'rose' }, font: 'inter', monoFont: 'fira-code', radius: 'sm' },
        version: 4,
      }),
    );
    const s = (await loadStore()).getState();
    expect(s.style).toBe('ultramarine');
    expect(s.accent).toEqual({ kind: 'preset', id: 'rose' });
    expect(s.font).toBe('inter');
    expect(s.radius).toBe('sm');
  });
});
