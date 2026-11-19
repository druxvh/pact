import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { timeOfDay } from '@/features/home/TimeGlyph';
import { contrast, type Oklch, oklchToRgb, parseHex, type Rgb, rgbToOklch } from '@/lib/oklch';
import { ACCENT_PRESETS, type AccentChoice, accentCss, baseColor, deriveAccent } from './accent';
import { appearanceCss } from './apply';
import { fontById, interfaceFonts, monoFonts } from './fonts';
import { coerceThemeStyle, DUSK_ROSE, styleBundle, styleCss, styleSurfaces, themeStyleById } from './themeStyle';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const css = read('../../styles/dusk.css');

/** The custom properties declared in the block that starts with `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `block ${selector}`).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));
}
const LIGHT = tokens("html[data-style='dusk']:root");
const DARK = tokens("html.dark[data-style='dusk']");

const rgbOf = (hex: string): Rgb => parseHex(hex) as Rgb;
const ink = (hex: string): Oklch => rgbToOklch(rgbOf(hex));
const hex = (t: Record<string, string>, k: string) => {
  const v = t[k];
  expect(v, k).toMatch(/^#[0-9a-f]{6}$/i);
  return v as string;
};
const parseOklch = (s: string): Oklch => {
  const m = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)/.exec(s) as RegExpExecArray;
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
};
/** `rgb(r g b / a%)` laid over an opaque surface. */
function over(alphaRgb: string, surface: string): Oklch {
  const m = /rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)/.exec(alphaRgb) as RegExpExecArray;
  const a = Number(m[4]) / 100;
  const s = rgbOf(surface);
  const mix = (top: string | undefined, under: number) => Math.round(Number(top) * a + under * (1 - a));
  return rgbToOklch({ r: mix(m[1], s.r), g: mix(m[2], s.g), b: mix(m[3], s.b) });
}

const SURFACES = ['--background', '--card', '--popover', '--muted', '--secondary'];
const INKS = ['--foreground', '--card-foreground', '--popover-foreground', '--secondary-foreground', '--muted-foreground', '--subtle-foreground'];
const STATUS_TEXT = ['--success-text', '--warning-text', '--destructive-text'];

// ── a tiny CSS reader: every style rule with the at-rules it sits in ──────────────────────────────────────────────────────────
type Rule = { selector: string; at: string[]; decls: string[] };
function parseRules(source: string): Rule[] {
  // `;` inside a data: URI (`data:image/svg+xml,…`) never occurs, but `{`/`}` could in a url — keep url(...) bodies out of the scan
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\("[^"]*"\)/g, 'url(x)');
  const rules: Rule[] = [];
  const stack: Array<{ prelude: string; decls: string[] }> = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '{') {
      stack.push({ prelude: buf.trim(), decls: [] });
      buf = '';
    } else if (ch === ';') {
      if (buf.trim()) stack[stack.length - 1]?.decls.push(buf.trim());
      buf = '';
    } else if (ch === '}') {
      if (buf.trim()) stack[stack.length - 1]?.decls.push(buf.trim());
      buf = '';
      const top = stack.pop();
      if (top && !top.prelude.startsWith('@')) rules.push({ selector: top.prelude, at: stack.map((s) => s.prelude), decls: top.decls });
    } else buf += ch;
  }
  return rules;
}
/** Split a selector list on the commas that are not inside parentheses (`:is(a, b)`). */
function selectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const RULES = parseRules(css).filter((r) => !r.at.some((a) => a.startsWith('@keyframes')));
const NO_PREF = '@media (prefers-reduced-motion: no-preference)';

describe('Dusk in the registry', () => {
  it('is named Dusk, with a rose accent, Instrument Sans + Geist Mono, large corners and Fraunces for display', () => {
    const d = themeStyleById('dusk');
    expect(d.label).toBe('Dusk');
    expect(d.description.length).toBeGreaterThan(20);
    expect(d.bundle).toEqual({ accent: { kind: 'custom', hex: DUSK_ROSE }, font: 'instrument-sans', monoFont: 'geist-mono', radius: 'lg' });
    expect(DUSK_ROSE).toBe('#DE5A84');
    expect(fontById(d.bundle.font)?.category).toBe('sans');
    expect(fontById(d.bundle.monoFont)?.category).toBe('mono');
    expect(d.fonts).toEqual(['fraunces']);
    expect(d.preview.wallpaperStill).toBe(true);
    expect(d.preview.displayFont).toBe('fraunces');
  });

  it('an older install that stored the retired Terminal style lands on Dusk; unknown values still mean Default', () => {
    expect(coerceThemeStyle('terminal')).toBe('dusk');
    expect(coerceThemeStyle('dusk')).toBe('dusk');
    expect(coerceThemeStyle('toString')).toBe('default'); // never an inherited property of the lookup table
    expect(coerceThemeStyle('__proto__')).toBe('default');
    expect(coerceThemeStyle(undefined)).toBe('default');
  });

  it('a stored Terminal look becomes Dusk with Dusk’s own accent, fonts and roundness (not the green, the mono font or the square corners)', async () => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem(
      'pact-appearance',
      JSON.stringify({
        state: { style: 'terminal', accent: { kind: 'custom', hex: '#2FC460' }, font: 'jetbrains-mono', monoFont: 'jetbrains-mono', radius: 'none' },
        version: 4,
      }),
    );
    const s = (await import('@/store/useAppearanceStore')).useAppearanceStore.getState();
    expect(s.style).toBe('dusk');
    expect({ accent: s.accent, font: s.font, monoFont: s.monoFont, radius: s.radius }).toEqual(styleBundle('dusk'));
    localStorage.clear();
  });

  it('Terminal is gone: no style, no VT323 font, no scanline or glow plumbing left in the registry', () => {
    const src = read('./themeStyle.ts');
    expect(src).not.toMatch(/TERMINAL_GREEN|scanlines|displayScale|\bglow\b/);
    expect(fontById('vt323')).toBeUndefined();
    expect(read('./fontLoader.ts')).not.toMatch(/vt323/i);
    expect(read('./fonts.ts')).not.toMatch(/vt323/i);
    expect(JSON.parse(read('../../../package.json')).dependencies['@fontsource/vt323']).toBeUndefined();
  });

  it('Fraunces is a variable display face (optical size + SOFT in the "full" file) that the pickers never offer, and its file is bundled', () => {
    const f = fontById('fraunces');
    expect(f?.category).toBe('display');
    expect(f?.source).toBe('variable');
    expect(f?.axes).toBe('full');
    expect(f?.fallback).toBe('serif');
    expect(interfaceFonts().some((x) => x.id === 'fraunces')).toBe(false);
    expect(monoFonts().some((x) => x.id === 'fraunces')).toBe(false);
    expect(() => readFileSync(resolve(__dirname, '../../../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2'))).not.toThrow();
    const pkg = JSON.parse(read('../../../node_modules/@fontsource-variable/fraunces/package.json')) as { license: string };
    expect(pkg.license).toBe('OFL-1.1');
    // the loader reaches the "full" file explicitly and does not also bundle the plain-weight one
    const loader = read('./fontLoader.ts');
    expect(loader).toMatch(/fraunces\/files\/fraunces-latin-full-normal\.woff2/);
    expect(loader).toMatch(/!\/node_modules\/@fontsource-variable\/\{[^}]*\bfraunces\b[^}]*\}/);
  });

  it('hands the CSS layer Fraunces through the display-font variable (a serif fallback while it loads)', () => {
    expect(styleCss('dusk')).toContain("--pact-font-display:'Fraunces Variable', ui-serif");
    expect(appearanceCss({ ...styleBundle('dusk'), style: 'dusk', wallpaper: { kind: 'none' }, dim: { light: 0, dark: 0 } })).toContain(
      "--pact-font-display:'Fraunces Variable'",
    );
  });

  it('declares the surfaces the accent is adapted to, and they are exactly the ones the CSS paints', () => {
    const { surfaces } = themeStyleById('dusk');
    expect(surfaces?.light).toEqual(SURFACES.map((k) => hex(LIGHT, k)));
    expect(surfaces?.dark).toEqual(SURFACES.map((k) => hex(DARK, k)));
  });

  it('the picker preview draws the same palette as the CSS (so the card shows what you get)', () => {
    const { preview } = themeStyleById('dusk');
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

  it('only Dusk (and the styles that opt in) change how the accent is adapted: Default and Dot Matrix keep the stock surfaces (pixel-identical)', () => {
    expect(styleSurfaces('default')).toBeUndefined();
    expect(styleSurfaces('dotmatrix')).toBeUndefined();
    expect(styleSurfaces('dusk')?.light).toHaveLength(5);
    expect(styleSurfaces('dusk')?.dark).toHaveLength(5);
    expect(accentCss({ kind: 'preset', id: 'orange' })).toBe('');
  });
});

describe('Dusk palette (styles/dusk.css)', () => {
  it('dark only re-declares tokens light has (it never invents one), and both define every surface, ink and status token', () => {
    for (const k of Object.keys(DARK)) expect(Object.keys(LIGHT), k).toContain(k);
    for (const k of [
      ...SURFACES,
      ...INKS,
      ...STATUS_TEXT,
      '--border',
      '--input',
      '--accent',
      '--ring',
      '--du-rose',
      '--du-gold',
      '--du-sel',
      '--du-edge',
      '--du-shade',
    ]) {
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

    it(`${name}: a field’s border (--input) reads ≥ 3:1 on the page, cards and popovers, and so does the gold focus ring`, () => {
      for (const s of ['--background', '--card', '--popover']) {
        expect(contrast(over(t['--input'] as string, hex(t, s)), ink(hex(t, s))), `${name} --input on ${s}`).toBeGreaterThanOrEqual(3);
      }
      for (const s of SURFACES) expect(contrast(ink(hex(t, '--ring')), ink(hex(t, s))), `${name} --ring on ${s}`).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: a destructive button’s label reads on its fill`, () => {
      expect(contrast(ink(hex(t, '--destructive-foreground')), ink(hex(t, '--destructive')))).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name}: the text under a rose selection stays ≥ 4.5:1 (ink on the selection tint, on every surface)`, () => {
      for (const s of SURFACES) {
        expect(contrast(ink(hex(t, '--foreground')), over(t['--du-sel'] as string, hex(t, s))), `${name} selection on ${s}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${name}: the accent's text colour — for the bundle's rose AND any accent a user picks — stays ≥ 4.5:1 on every surface and its soft tint; the label on the fill reads`, () => {
      const surfaces = styleSurfaces('dusk');
      const choices: AccentChoice[] = [
        themeStyleById('dusk').bundle.accent,
        ...ACCENT_PRESETS.map((p): AccentChoice => ({ kind: 'preset', id: p.id })),
        ...['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ffffff', '#000000', '#808080', '#f6c177', '#eb6f92'].map(
          (h): AccentChoice => ({ kind: 'custom', hex: h }),
        ),
      ];
      const pct = Number(/var\(--brand\) ([\d.]+)%/.exec(t['--brand-soft'] ?? '')?.[1]) / 100;
      expect(pct, '--brand-soft is a percentage of --brand').toBeGreaterThan(0);
      for (const choice of choices) {
        const label = choice.kind === 'preset' ? choice.id : choice.hex;
        const t2 = deriveAccent(baseColor(choice, name), name, surfaces?.[name]);
        const text = parseOklch(t2['--brand-text']);
        const brand = oklchToRgb(parseOklch(t2['--brand']));
        for (const s of SURFACES) {
          expect(contrast(text, ink(hex(t, s))), `${name} ${label} text on ${s}`).toBeGreaterThanOrEqual(4.5);
          const surface = rgbOf(hex(t, s));
          const mix = (a: number, b: number) => Math.round(a * (1 - pct) + b * pct);
          const tinted = rgbToOklch({ r: mix(surface.r, brand.r), g: mix(surface.g, brand.g), b: mix(surface.b, brand.b) });
          expect(contrast(text, tinted), `${name} ${label} text on its soft tint over ${s}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(contrast(parseOklch(t2['--brand-foreground']), parseOklch(t2['--brand'])), `${name} ${label} label on the fill`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${name}: the rose fill itself holds ≥ 3:1 against the page (a switch that is on, a filled button, the active marker)`, () => {
      const brand = baseColor(themeStyleById('dusk').bundle.accent, name);
      expect(contrast(brand, ink(hex(t, '--background')))).toBeGreaterThanOrEqual(3);
      expect(contrast(brand, ink(hex(t, '--card')))).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: soft plum shadows with a lip on top — never a coloured glow`, () => {
      for (const k of ['--elev-1', '--elev-2', '--elev-3', '--elev-pop']) {
        expect(t[k], `${name} ${k}`).toContain('var(--du-edge)');
        expect(t[k], `${name} ${k}`).toContain('rgb(var(--du-shade)');
      }
      expect(t['--elev-brand']).toBeUndefined(); // the accent pipeline owns it; a custom accent's shadow follows the accent
      expect(t['--ambient-1']).toBeUndefined();
    });
  }

  it('plum and cream: dark is a deep plum-black with rose and gold, light is warm cream with a deeper rose', () => {
    const bg = ink(hex(DARK, '--background'));
    expect(bg.l).toBeLessThan(0.25);
    expect(bg.h).toBeGreaterThan(280);
    expect(bg.h).toBeLessThan(330);
    const fg = ink(hex(DARK, '--foreground'));
    expect(fg.l).toBeGreaterThan(0.9);
    const cream = ink(hex(LIGHT, '--background'));
    expect(cream.l).toBeGreaterThan(0.95);
    expect(cream.h).toBeGreaterThan(55);
    expect(cream.h).toBeLessThan(100);
    // dusk's rose and gold are Rosé Pine's, dawn's are the deeper tones
    expect(DARK['--du-rose']).toBe('#eb6f92');
    expect(DARK['--du-gold']).toBe('#f6c177');
    expect(ink(hex(LIGHT, '--du-rose')).l).toBeLessThan(ink(hex(DARK, '--du-rose')).l);
    expect(ink(hex(LIGHT, '--du-gold')).l).toBeLessThan(ink(hex(DARK, '--du-gold')).l);
    // the selection is rose (a hue near 0°/360°), the focus ring is gold (a hue near 60–90°)
    expect(ink(hex(DARK, '--du-rose')).h).toBeLessThan(15);
    expect(ink(hex(DARK, '--ring')).h).toBeGreaterThan(60);
    expect(ink(hex(DARK, '--ring')).h).toBeLessThan(95);
  });

  it('status colours are recognisable: red-orange to destructive, amber to warning, green-teal to success', () => {
    for (const t of [LIGHT, DARK]) {
      expect(ink(hex(t, '--destructive-text')).h).toBeLessThan(30);
      expect(ink(hex(t, '--warning-text')).h).toBeGreaterThan(55);
      expect(ink(hex(t, '--warning-text')).h).toBeLessThan(95);
      const s = ink(hex(t, '--success-text')).h;
      expect(s).toBeGreaterThan(150);
      expect(s).toBeLessThan(200);
    }
  });
});

describe('Dusk CSS rules', () => {
  it('everything is keyed on html[data-style="dusk"], so the other styles are untouched', () => {
    expect(RULES.length).toBeGreaterThan(40);
    for (const r of RULES) {
      for (const sel of selectors(r.selector)) expect(sel, `selector: ${sel}`).toMatch(/^html(\.dark)?\[data-style='dusk'\]/);
    }
  });

  it('every animation runs only when motion is welcome (OS preference), and never for the in-app “Reduced” setting', () => {
    const animated = RULES.filter((r) => r.decls.some((d) => /^animation(-name)?\s*:/.test(d) && d !== 'animation: none'));
    expect(animated.length).toBeGreaterThanOrEqual(4);
    for (const r of animated) {
      expect(r.at, r.selector).toContain(NO_PREF);
      expect(r.selector, `${r.selector} honours data-motion=reduced`).toContain(":not([data-motion='reduced'])");
    }
    // the springy toggles and the button lift are transitions: they too wait for motion to be welcome
    const springy = RULES.filter((r) => r.decls.some((d) => d.includes('var(--ease-spring)')));
    expect(springy.length).toBeGreaterThan(3);
    for (const r of springy) {
      expect(r.at, r.selector).toContain(NO_PREF);
      expect(r.selector, `${r.selector} honours data-motion=reduced`).toContain(":not([data-motion='reduced'])");
    }
    const lift = RULES.filter((r) => r.decls.some((d) => /^translate:\s*0 -1px/.test(d)));
    expect(lift.length).toBeGreaterThan(0);
    for (const r of lift) expect(r.at, r.selector).toContain(NO_PREF);
  });

  it('the grain is ONE fixed, pointer-events:none layer painted from a tiled noise mask — nothing else in the style is fixed', () => {
    const fixed = RULES.filter((r) => r.decls.some((d) => /^position:\s*fixed/.test(d)));
    expect(fixed).toHaveLength(1);
    expect(fixed[0]?.selector).toBe("html[data-style='dusk']::after");
    expect(fixed[0]?.decls).toContain('pointer-events: none');
    const opacity = Number(/--du-grain-opacity:\s*([\d.]+)/.exec(css)?.[1]);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThanOrEqual(0.06); // a whisper, not a texture filter
    for (const k of ['--du-grain-opacity']) {
      expect(Number(LIGHT[k])).toBeLessThanOrEqual(0.06);
      expect(Number(DARK[k])).toBeLessThanOrEqual(0.06);
    }
    expect(css).toMatch(/mask-image: url\("data:image\/svg\+xml[^"]*feTurbulence/);
  });

  it('never filters the page or blurs what is behind it (the wallpaper animates, so a backdrop blur would repaint every frame)', () => {
    for (const r of RULES) {
      for (const d of r.decls) {
        const m = /^(-webkit-)?backdrop-filter:\s*(.+)$/.exec(d);
        if (m) expect(m[2], `${r.selector} backdrop-filter`).toBe('none');
        const f = /^filter:\s*(.+)$/.exec(d);
        if (f) expect(f[1], `${r.selector} filter`).toBe('none');
      }
    }
    expect(css).toMatch(/--sw-blur:\s*0px/);
    expect(css).not.toMatch(/mix-blend-mode:\s*(?!normal)/);
  });

  it('keeps the hooks the components expose and the details the brief asks for', () => {
    for (const hook of [
      '[data-display]',
      '[data-logo]',
      '[data-glyph',
      '[data-page-header]',
      '[data-ring]',
      '#timer-ring',
      '--ring-progress',
      '::selection',
      "[role='switch']",
      "input[type='checkbox']",
    ]) {
      expect(css, hook).toContain(hook);
    }
    expect(read('../../features/home/Clock.tsx')).toContain('<p data-greeting');
    expect(read('../../features/home/Clock.tsx')).toContain('TimeGlyph');
    expect(read('../../features/timer/AnimatedDigits.tsx')).toContain('data-display');
    expect(read('../../features/timer/TimerRing.tsx')).toMatch(/--ring-progress/);
    expect(read('../../features/timer/TimerRing.tsx')).toContain('data-ring');
    expect(read('../../components/Logo.tsx')).toContain('data-logo');
    expect(read('../../app/AppShell.tsx')).toContain('dataset.motion');
  });

  it('is rid of the Terminal look: no prompts, cursor, scanlines, phosphor, flicker or VT323', () => {
    expect(css).not.toMatch(/data-prompt|caret-shape|scanline|phosphor|flicker|vt323|content:\s*'[>_]/i);
    expect(read('../../features/home/Clock.tsx')).not.toContain('data-prompt');
  });

  it('buttons are pills, the greeting has a glyph per time of day, and the colon breathes slowly', () => {
    const pill = RULES.find((r) => r.selector.includes("[data-variant]:not([data-variant='link'])"));
    expect(pill?.decls).toContain('border-radius: 9999px');
    for (const tod of ['sunrise', 'sun', 'sunset', 'moon']) expect(css, tod).toContain(`[data-glyph='${tod}']`);
    const breathe = RULES.find((r) => r.decls.some((d) => d.startsWith('animation: du-breathe')));
    const secs = Number(/animation: du-breathe ([\d.]+)s/.exec(breathe?.decls.find((d) => d.startsWith('animation: du-breathe')) ?? '')?.[1]);
    expect(secs).toBeGreaterThanOrEqual(4);
  });

  it('only ever uses the accent as a fill or through --brand-text, never as bare text colour', () => {
    for (const m of css.matchAll(/(?<![-\w])color:\s*([^;]+);/g)) expect(m[1], 'color value').toMatch(/^var\(/);
  });

  it('the timer arc drifts from gold to rose with the progress the ring writes (and a break drifts foam → iris)', () => {
    expect(css).toMatch(/#timer-ring stop:first-child[^}]*var\(--ring-progress/);
    expect(css).toMatch(/\[data-tone='success'\] #timer-ring stop:first-child/);
    expect(css).toMatch(/var\(--du-rose\)[^;]*var\(--du-gold\)/);
  });

  it('the wallpaper contract: card tint over the scene, no blur, Home shows the sky and every other page steps it back (see features/stylewall/README.md)', () => {
    expect(css).toMatch(/--sw-card:\s*8\d%/);
    expect(css).toMatch(/html\[data-style='dusk'\]\[data-wallpaper\] \.bg-card/);
    const home = Number(/html\[data-style='dusk'\] \{[^}]*--sw-scrim:\s*([\d.]+)/.exec(css)?.[1]);
    const work = Number(/:has\(main:not\(\[data-section='home'\]\)\) \{[^}]*--sw-scrim:\s*([\d.]+)/.exec(css)?.[1]);
    expect(home).toBeGreaterThan(0);
    expect(home).toBeLessThan(0.5);
    expect(work).toBeGreaterThanOrEqual(0.7);
    expect(work).toBeLessThanOrEqual(0.9);
    // text that sits straight on the sky gets a plate (greeting, hint, shortcut labels), so the picture never costs it legibility
    for (const hook of ['[data-greeting]', '[data-hint]', '.tile-label']) expect(css, hook).toContain(hook);
    expect(read('../../features/home/HomeView.tsx')).toContain('data-hint');
  });

  it('keeps the palette to the sunset: the Kanban progress bar runs rose into gold, not green', () => {
    expect(css).toMatch(/\[class\*='from-brand'\]\[class\*='to-success'\][^}]*--tw-gradient-to:\s*var\(--du-gold\)/);
  });
});

describe('the greeting glyph', () => {
  it('follows the sky: sunrise early, a sun through the day, sunset in the evening, a moon after', () => {
    const cases: Array<[number, string]> = [
      [0, 'moon'],
      [4, 'moon'],
      [5, 'sunrise'],
      [7, 'sunrise'],
      [8, 'sun'],
      [12, 'sun'],
      [16, 'sun'],
      [17, 'sunset'],
      [19, 'sunset'],
      [20, 'moon'],
      [23, 'moon'],
    ];
    for (const [h, want] of cases) expect(timeOfDay(h), `${h}:00`).toBe(want);
  });
});
