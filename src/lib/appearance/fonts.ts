/**
 * Fonts the user can choose. All are bundled with the extension (Fontsource, open-licensed) — nothing is fetched from
 * a font CDN, which would both leak a request on every new tab and break offline. Only the Latin subset ships; text in
 * other scripts falls back to the system font through the stack.
 *
 * This file is pure data + CSS builders (so it is unit-testable); `fontLoader.ts` resolves the actual file URLs.
 */
/** `display` faces (dot-matrix Doto) are only for big text a theme style opts into — never offered as the interface or code font. */
export type FontCategory = 'sans' | 'serif' | 'mono' | 'system' | 'display';

export type FontDef = {
  id: string;
  label: string;
  category: FontCategory;
  /** font-family name in our @font-face rule (Geist's is declared by its own package CSS). */
  family: string;
  /** Fontsource package folder (without scope). Absent for system fonts. */
  pkg?: string;
  /** 'variable' fonts ship one file covering every weight; 'static' fonts one file per weight. */
  source?: 'variable' | 'static';
  /** Which Fontsource variable file: `wght` (weight axis only, the default) or `full` (every axis — Doto's `ROND` roundness needs it). */
  axes?: 'wght' | 'full';
  weights?: readonly number[];
  /** OpenType features to switch on (Geist's stylistic sets look wrong on other families). */
  features?: string;
  /** Which generic family to fall back to while it loads, when the category alone would pick the wrong one (a serif display face). */
  fallback?: 'sans' | 'serif' | 'mono';
  /** Already loaded by globals.css. */
  builtIn?: boolean;
};

const SANS_FALLBACK = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif";
const SERIF_FALLBACK = "ui-serif, Georgia, 'Times New Roman', serif";
const MONO_FALLBACK = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const v = (id: string, label: string, category: FontCategory, extra: Partial<FontDef> = {}): FontDef => ({
  id,
  label,
  category,
  family: `${label} Variable`,
  pkg: id,
  source: 'variable',
  ...extra,
});
const s = (id: string, label: string, category: FontCategory, weights: readonly number[]): FontDef => ({
  id,
  label,
  category,
  family: label,
  pkg: id,
  source: 'static',
  weights,
});

export const FONTS: readonly FontDef[] = [
  // — sans —
  { id: 'geist', label: 'Geist', category: 'sans', family: 'Geist Variable', pkg: 'geist', source: 'variable', builtIn: true, features: "'cv11', 'ss01'" },
  v('inter', 'Inter', 'sans'),
  s('roboto', 'Roboto', 'sans', [300, 400, 500, 700]),
  v('open-sans', 'Open Sans', 'sans'),
  s('lato', 'Lato', 'sans', [300, 400, 700]),
  v('montserrat', 'Montserrat', 'sans'),
  s('poppins', 'Poppins', 'sans', [300, 400, 500, 600, 700]),
  v('nunito', 'Nunito', 'sans'),
  v('dm-sans', 'DM Sans', 'sans'),
  v('manrope', 'Manrope', 'sans'),
  v('plus-jakarta-sans', 'Plus Jakarta Sans', 'sans'),
  v('outfit', 'Outfit', 'sans'),
  v('work-sans', 'Work Sans', 'sans'),
  v('source-sans-3', 'Source Sans 3', 'sans'),
  v('raleway', 'Raleway', 'sans'),
  v('space-grotesk', 'Space Grotesk', 'sans'),
  v('sora', 'Sora', 'sans'),
  v('figtree', 'Figtree', 'sans'),
  v('rubik', 'Rubik', 'sans'),
  v('ibm-plex-sans', 'IBM Plex Sans', 'sans'),
  v('lexend', 'Lexend', 'sans'),
  v('bricolage-grotesque', 'Bricolage Grotesque', 'sans'),
  v('instrument-sans', 'Instrument Sans', 'sans'),
  v('mona-sans', 'Mona Sans', 'sans'),
  { id: 'system', label: 'System UI', category: 'system', family: '' },
  // — serif —
  v('playfair-display', 'Playfair Display', 'serif'),
  v('merriweather', 'Merriweather', 'serif'),
  v('lora', 'Lora', 'serif'),
  v('source-serif-4', 'Source Serif 4', 'serif'),
  // — mono (used for code, numbers, shortcuts) —
  { id: 'geist-mono', label: 'Geist Mono', category: 'mono', family: 'Geist Mono Variable', pkg: 'geist-mono', source: 'variable', builtIn: true },
  v('jetbrains-mono', 'JetBrains Mono', 'mono'),
  v('fira-code', 'Fira Code', 'mono'),
  v('source-code-pro', 'Source Code Pro', 'mono'),
  v('roboto-mono', 'Roboto Mono', 'mono'),
  s('ibm-plex-mono', 'IBM Plex Mono', 'mono', [400, 500, 600]),
  s('space-mono', 'Space Mono', 'mono', [400, 700]),
  { id: 'system-mono', label: 'System mono', category: 'mono', family: '' },
  // — display (a theme style's big type: clock digits, page titles) —
  v('doto', 'Doto', 'display', { axes: 'full' }),
  // A tall condensed grotesque with a light cut (200–700): Ultramarine's clock, page titles and micro-labels. Display only — at 13px it
  // is too narrow to read in a paragraph.
  v('oswald', 'Oswald', 'display', { fallback: 'sans' }),
  // A soft, warm serif with an optical-size axis (the display cut at clock size, the text cut at 16px) and a SOFT axis the style turns up; "full" ships both.
  v('fraunces', 'Fraunces', 'display', { axes: 'full', fallback: 'serif' }),
];

export const DEFAULT_SANS = 'geist';
export const DEFAULT_MONO = 'geist-mono';

export const fontById = (id: string): FontDef | undefined => FONTS.find((f) => f.id === id);
export const interfaceFonts = () => FONTS.filter((f) => f.category !== 'mono' && f.category !== 'display');
export const monoFonts = () => FONTS.filter((f) => f.category === 'mono');

/** The CSS `font-family` value for a font, with fallbacks matched to its category. */
export function fontStack(font: FontDef): string {
  const kind = font.fallback ?? (font.category === 'mono' || font.category === 'display' ? 'mono' : font.category === 'serif' ? 'serif' : 'sans');
  const fallback = kind === 'serif' ? SERIF_FALLBACK : kind === 'mono' ? MONO_FALLBACK : SANS_FALLBACK;
  return font.family ? `'${font.family}', ${fallback}` : fallback;
}

/** @font-face rules for a font, given the resolved URL(s): one for a variable font, one per weight for a static one. */
export function fontFaceCss(font: FontDef, urls: Record<string, string>): string {
  if (!font.family) return '';
  const face = (weight: string, url: string) =>
    `@font-face{font-family:'${font.family}';font-style:normal;font-display:swap;font-weight:${weight};src:url(${url}) format('woff2');}`;
  if (font.source === 'variable') {
    const url = urls.variable;
    return url ? face('100 900', url) : '';
  }
  return (font.weights ?? []).map((w) => (urls[String(w)] ? face(String(w), urls[String(w)] as string) : '')).join('');
}

/** CSS variable overrides for the chosen fonts ('' when both are the defaults). */
export function fontVarsCss(sansId: string, monoId: string): string {
  const sans = fontById(sansId);
  const mono = fontById(monoId);
  const parts: string[] = [];
  if (sans && sans.id !== DEFAULT_SANS) {
    parts.push(`--pact-font-sans:${fontStack(sans)}`);
    parts.push(`--pact-font-features:${sans.features ?? 'normal'}`);
  }
  if (mono && mono.id !== DEFAULT_MONO) parts.push(`--pact-font-mono:${fontStack(mono)}`);
  return parts.length ? `html:root{${parts.join(';')}}` : '';
}
