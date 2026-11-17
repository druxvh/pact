/**
 * Accent colour: one choice drives every brand token in both themes.
 *
 * Picking a colour is not enough — a pale yellow button needs dark ink, a deep blue needs light ink, and brand-coloured
 * *text* has to stay readable on white and on near-black. So each theme's tokens are derived from the pick and checked
 * against real contrast ratios (WCAG 4.5:1), nudging lightness when needed. The default orange emits no override at
 * all, so the stock look is untouched.
 */
import { contrast, fitToGamut, type Oklch, oklchCss, oklchToHex, parseHex, rgbToOklch } from '@/lib/oklch';

export type AccentPreset = { id: string; label: string; light: Oklch; dark?: Oklch };
export type AccentChoice = { kind: 'preset'; id: string } | { kind: 'custom'; hex: string };
export type ThemeName = 'light' | 'dark';

const c = (l: number, ch: number, h: number): Oklch => ({ l, c: ch, h });

export const DEFAULT_ACCENT_ID = 'orange';

export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: 'orange', label: 'Orange', light: c(0.705, 0.213, 47.6) },
  { id: 'red', label: 'Red', light: c(0.64, 0.22, 25) },
  { id: 'rose', label: 'Rose', light: c(0.68, 0.2, 8) },
  { id: 'pink', label: 'Pink', light: c(0.72, 0.2, 350) },
  { id: 'fuchsia', label: 'Fuchsia', light: c(0.66, 0.25, 320) },
  { id: 'violet', label: 'Violet', light: c(0.62, 0.22, 295) },
  { id: 'indigo', label: 'Indigo', light: c(0.6, 0.2, 272) },
  { id: 'blue', label: 'Blue', light: c(0.64, 0.19, 255) },
  { id: 'sky', label: 'Sky', light: c(0.72, 0.15, 230) },
  { id: 'cyan', label: 'Cyan', light: c(0.76, 0.13, 205) },
  { id: 'teal', label: 'Teal', light: c(0.72, 0.13, 185) },
  { id: 'emerald', label: 'Emerald', light: c(0.72, 0.17, 160) },
  { id: 'green', label: 'Green', light: c(0.72, 0.19, 145) },
  { id: 'lime', label: 'Lime', light: c(0.84, 0.19, 125) },
  { id: 'yellow', label: 'Yellow', light: c(0.87, 0.17, 95) },
  { id: 'amber', label: 'Amber', light: c(0.8, 0.17, 75) },
  // A neutral: near-black buttons on light, near-white on dark.
  { id: 'graphite', label: 'Graphite', light: c(0.27, 0.006, 260), dark: c(0.93, 0.006, 260) },
];

export const presetById = (id: string) => ACCENT_PRESETS.find((p) => p.id === id);

/** The accent's base colour for a theme (clamped so ink and text can always be made legible). */
export function baseColor(choice: AccentChoice, theme: ThemeName): Oklch {
  if (choice.kind === 'preset') {
    const p = presetById(choice.id) ?? ACCENT_PRESETS[0];
    if (!p) throw new Error('no accent presets');
    return theme === 'dark' ? (p.dark ?? p.light) : p.light;
  }
  const rgb = parseHex(choice.hex);
  if (!rgb) return ACCENT_PRESETS[0]?.light as Oklch;
  const o = rgbToOklch(rgb);
  return fitToGamut({ ...o, l: Math.min(0.84, Math.max(0.5, o.l)) });
}

// Surfaces brand-coloured text must stay readable on (see globals.css).
const SURFACE = {
  light: [c(1, 0, 0), c(0.985, 0, 0), c(0.96, 0, 0)],
  dark: [c(0.155, 0, 0), c(0.19, 0, 0), c(0.22, 0, 0)],
} as const;
const WHITE = c(0.985, 0, 0);
const TEXT_TARGET = 4.6; // a hair over AA so brand-soft tints don't tip it under

export type AccentTokens = Record<
  '--brand' | '--brand-foreground' | '--brand-text' | '--brand-soft' | '--brand-glow' | '--ring' | '--elev-brand' | '--ambient-1' | '--ambient-2',
  string
>;

function textColor(brand: Oklch, theme: ThemeName): Oklch {
  const surfaces = SURFACE[theme];
  const ok = (col: Oklch) => surfaces.every((s) => contrast(col, s) >= TEXT_TARGET);
  let col = fitToGamut(brand);
  const step = theme === 'light' ? -0.005 : 0.005;
  for (let i = 0; i < 140 && !ok(col); i++) col = fitToGamut({ ...col, l: col.l + step });
  return col;
}

export function deriveAccent(brand: Oklch, theme: ThemeName): AccentTokens {
  const b = fitToGamut(brand);
  const ink = c(0.16, 0.03, b.h);
  const foreground = contrast(ink, b) >= contrast(WHITE, b) ? ink : WHITE;
  const text = textColor(b, theme);
  const dark = theme === 'dark';
  return {
    '--brand': oklchCss(b),
    '--brand-foreground': oklchCss(foreground),
    '--brand-text': oklchCss(text),
    '--brand-soft': oklchCss(b, dark ? 0.15 : 0.12),
    '--brand-glow': oklchCss(b, dark ? 0.38 : 0.32),
    '--ring': oklchCss(b),
    '--elev-brand': `0 6px ${dark ? 24 : 20}px -6px ${oklchCss(b, dark ? 0.5 : 0.55)}`,
    '--ambient-1': oklchCss(b, dark ? 0.13 : 0.1),
    '--ambient-2': oklchCss(c(0.65, 0.18, (b.h + 110) % 360), dark ? 0.07 : 0.05),
  };
}

/** Colours for the pact mark: a gradient around the accent, and ink that stays legible on it (same rule as `--brand-foreground`). */
export function logoColors(choice: AccentChoice, theme: ThemeName = 'light'): { from: string; to: string; ink: string } {
  const b = fitToGamut(baseColor(choice, theme));
  const ink = c(0.16, 0.03, b.h);
  const foreground = contrast(ink, b) >= contrast(WHITE, b) ? ink : WHITE;
  return {
    from: oklchToHex(fitToGamut({ ...b, l: Math.min(0.97, b.l + 0.07) })),
    to: oklchToHex(fitToGamut({ ...b, l: Math.max(0.2, b.l - 0.06) })),
    ink: oklchToHex(foreground),
  };
}

const block = (selector: string, tokens: AccentTokens) =>
  `${selector}{${Object.entries(tokens)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')}}`;

/** CSS that re-themes the whole app, or '' for the stock orange. `html:root` / `html.dark` outrank the base tokens. */
export function accentCss(choice: AccentChoice): string {
  if (choice.kind === 'preset' && choice.id === DEFAULT_ACCENT_ID) return '';
  return block('html:root', deriveAccent(baseColor(choice, 'light'), 'light')) + block('html.dark', deriveAccent(baseColor(choice, 'dark'), 'dark'));
}

/** A representative swatch colour for the picker. */
export const swatchHex = (choice: AccentChoice) => oklchToHex(baseColor(choice, 'light'));

export const isValidHex = (s: string) => parseHex(s) !== null;
