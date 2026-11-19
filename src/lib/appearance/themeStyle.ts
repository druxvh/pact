/**
 * Theme styles: a whole look — palette, texture, type — that sits next to Light / Dark / System.
 *
 * A style is two things:
 *   1. a **bundle** of the settings the appearance pipeline already has (accent, interface font, code font, roundness),
 *      applied once when the style is picked, and
 *   2. a **CSS layer** in `styles/<id>.css`, keyed on `html[data-style="<id>"]`, for what the pipeline can't express
 *      (neutral palette, page texture, dotted separators, display type…).
 *
 * Picking a style overwrites the bundle's settings; changing accent / font / roundness afterwards is allowed and the style
 * stays selected (only the style's own CSS layer and its palette remain). Picking Default restores the stock look. "Reset" in
 * Appearance also returns to Default. Nothing here is specific to one style — add an entry to `THEME_STYLES`, a CSS file
 * keyed on its id, and (if it has display type) the font to `fonts` and the preview palette; the picker, store, first-paint
 * cache and backups all follow from the registry.
 */
import { parseHex, rgbToOklch } from '@/lib/oklch';
import { type AccentChoice, DEFAULT_ACCENT_ID, type TextSurfaces } from './accent';
import { DEFAULT_MONO, DEFAULT_SANS, fontById, fontStack } from './fonts';
import { DEFAULT_RADIUS, type RadiusId } from './radius';
import type { Wallpaper } from './wallpaper';

export const THEME_STYLE_IDS = ['default', 'dotmatrix', 'ultramarine', 'dusk'] as const;
export type ThemeStyleId = (typeof THEME_STYLE_IDS)[number];

export const DEFAULT_THEME_STYLE: ThemeStyleId = 'default';

export const isThemeStyleId = (v: unknown): v is ThemeStyleId => (THEME_STYLE_IDS as readonly unknown[]).includes(v);

/** Styles that were renamed or replaced while in development: what a stored id of the old name becomes. */
const RETIRED_STYLES: Readonly<Record<string, ThemeStyleId>> = { stoic: 'ultramarine', terminal: 'dusk' };

/** The style that took the place of a retired one (undefined for anything else): its whole bundle should replace what the old one had stored. */
export const retiredStyleSuccessor = (v: unknown): ThemeStyleId | undefined =>
  typeof v === 'string' && Object.hasOwn(RETIRED_STYLES, v) ? RETIRED_STYLES[v] : undefined;

/** Anything from storage or a file → a valid style; unknown or missing values (an older install) mean Default; a retired style maps to its successor. */
export const coerceThemeStyle = (v: unknown): ThemeStyleId =>
  isThemeStyleId(v) ? v : typeof v === 'string' && Object.hasOwn(RETIRED_STYLES, v) ? (RETIRED_STYLES[v] as ThemeStyleId) : DEFAULT_THEME_STYLE;

/**
 * The settings a style sets when it is picked. `font` is the interface font: usually a sans/serif/system face, but a style may set a
 * monospace one — the Font picker keeps listing only the usual choices, plus the current one marked "Set by the style".
 */
export type StyleBundle = { accent: AccentChoice; font: string; monoFont: string; radius: RadiusId };

/** Colours for the picker's drawn preview (so a card can show a style in the *current* light/dark whatever style is active). */
export type StylePalette = { bg: string; card: string; ink: string; muted: string; line: string };

export type StylePreview = {
  light: StylePalette;
  dark: StylePalette;
  /** Page texture behind the little Home: nothing, a dot grid or a dithered edge. */
  texture: 'none' | 'dots' | 'dither';
  /** An engraved plate drawn in the card's corner: Ultramarine's radiating halo (see features/ultramarine). */
  art?: 'halo';
  /** A thin frame in the accent round the card, as Ultramarine draws round the window. */
  frame?: boolean;
  /** The little search box ends in a small filled button (white on dark, the accent on light) instead of a swatch. */
  button?: boolean;
  /** A small uppercase label above the digits (Ultramarine's micro-label type). */
  eyebrow?: string;
  /** Weight of the digits in a variable display face (a light cut: Oswald at 250, Fraunces at 360); default is a firm 600. */
  displayWeight?: number;
  /** Draw the style's real wallpaper (a still of its stylewall scene) behind the little Home. */
  wallpaperStill?: boolean;
  /** Display font id for the clock digits (otherwise the interface font). */
  displayFont?: string;
  /** `font-variation-settings` for the digits (Fraunces' SOFT axis). */
  displayVariation?: string;
  /** The accent control in the picture is a pill (Dusk) rather than a rounded square. */
  pill?: boolean;
};

export type ThemeStyleDef = {
  id: ThemeStyleId;
  label: string;
  description: string;
  bundle: StyleBundle;
  /** Display fonts the style's CSS layer uses (loaded, and cached for first paint, while the style is on). */
  fonts: readonly string[];
  /**
   * The surface colours (hex) the style paints in light and dark, when they differ from the stock ones. The accent's text colour
   * (`--brand-text`) is adapted to stay ≥ 4.5:1 on *these* — a darker "paper" needs darker accent text than white does.
   */
  surfaces?: { light: readonly string[]; dark: readonly string[] };
  /** An animated wallpaper the style paints behind the app, drawn by features/stylewall. Absent = the style has none. */
  wallpaper?: StyleWallpaperDef;
  preview: StylePreview;
};

/** A style's animated wallpaper (the renderer lives in `features/stylewall/scenes/<scene>`; see its README for the contract). */
export type StyleWallpaperDef = {
  /** Key in the stylewall scene registry. */
  scene: string;
  /** What it is called in Settings, e.g. "Engraved Halo". */
  label: string;
  description: string;
  /** Variants the user can choose between (Ultramarine's engraving plates); the first is the default. Absent = a single scene. */
  plates?: ReadonlyArray<{ id: string; label: string }>;
};

/** Nothing's signal red as it appears on their own community site's theme (`themePrimaryColor`). See the report for sources. */
export const DOT_MATRIX_RED = '#D71921';

/** Ultramarine's electric blue, as saturated as the accent pipeline allows (it keeps an accent's lightness ≥ 0.5). Adapted lighter for text on the navy dark. */
export const ULTRAMARINE_BLUE = '#3A3AFF';

/** Dusk's rose: a shade deeper than Rosé Pine's "love" (#eb6f92), so the button fill holds 3:1 on dawn's cream as well as on dusk's plum. */
export const DUSK_ROSE = '#DE5A84';

export const THEME_STYLES: readonly ThemeStyleDef[] = [
  {
    id: 'default',
    label: 'Default',
    description: 'The classic pact look: soft surfaces and an orange accent.',
    bundle: { accent: { kind: 'preset', id: DEFAULT_ACCENT_ID }, font: DEFAULT_SANS, monoFont: DEFAULT_MONO, radius: DEFAULT_RADIUS },
    fonts: [],
    preview: {
      light: { bg: 'oklch(0.985 0 0)', card: 'oklch(1 0 0)', ink: 'oklch(0.15 0 0)', muted: 'oklch(0.46 0 0)', line: 'oklch(0 0 0 / 12%)' },
      dark: { bg: 'oklch(0 0 0)', card: 'oklch(0.155 0 0)', ink: 'oklch(0.985 0 0)', muted: 'oklch(0.72 0 0)', line: 'oklch(1 0 0 / 14%)' },
      texture: 'none',
    },
  },
  {
    id: 'dotmatrix',
    // Rename the style here and nowhere else: the picker and its hint read this entry.
    label: 'Dot Matrix',
    description: 'Black, white and one red dot. Inspired by Nothing’s design language.',
    bundle: {
      accent: { kind: 'custom', hex: DOT_MATRIX_RED },
      font: 'space-grotesk',
      monoFont: 'space-mono',
      radius: 'sm',
    },
    fonts: ['doto'],
    // Keep in step with the tokens in styles/dotmatrix.css (a test compares them).
    preview: {
      light: { bg: '#f3f3f3', card: '#ffffff', ink: '#050505', muted: '#575757', line: 'rgb(0 0 0 / 22%)' },
      dark: { bg: '#040404', card: '#0d0d0d', ink: '#ffffff', muted: '#a3a3a3', line: 'rgb(255 255 255 / 22%)' },
      texture: 'dots',
      displayFont: 'doto',
    },
  },
  {
    id: 'ultramarine',
    label: 'Ultramarine',
    description: 'Ink-navy, electric blue and fine engraved line art, set in tall light capitals.',
    // Mona Sans is the interface face (a refined grotesque — the one the reference site itself falls back to), Oswald the display face
    // (the clock, titles, micro-labels), JetBrains Mono the code face. Square corners; buttons keep a 3px edge in the CSS layer.
    bundle: { accent: { kind: 'custom', hex: ULTRAMARINE_BLUE }, font: 'mona-sans', monoFont: 'jetbrains-mono', radius: 'none' },
    fonts: ['oswald'],
    // Keep in step with the tokens in styles/ultramarine.css (a test compares them): background, card, popover, muted, secondary.
    surfaces: {
      light: ['#eceaf7', '#f6f5fc', '#fbfbff', '#e2e0f3', '#d8d6ee'],
      dark: ['#0d0d24', '#13132f', '#181838', '#1b1b3d', '#22224a'],
    },
    wallpaper: {
      scene: 'ultramarine',
      label: 'Engraved Halo',
      description:
        'A halo of engraved hairlines round an engraving plate — a stippled bust, Doré’s celestial rose or Dürer’s Melencolia — in ultramarine and lavender over ink-navy (navy ink on lavender paper in light).',
      plates: [
        { id: 'halo', label: 'Marcus' },
        { id: 'rose', label: 'Rose' },
        { id: 'melencolia', label: 'Melencolia' },
      ],
    },
    preview: {
      light: { bg: '#eceaf7', card: '#f6f5fc', ink: '#0d0d24', muted: '#44446e', line: 'rgb(26 26 140 / 28%)' },
      dark: { bg: '#0d0d24', card: '#13132f', ink: '#f2f2fa', muted: '#a6a6cf', line: 'rgb(133 133 249 / 34%)' },
      texture: 'none',
      art: 'halo',
      frame: true,
      button: true,
      eyebrow: '#1 Home',
      displayFont: 'oswald',
      displayWeight: 250,
      wallpaperStill: true,
    },
  },
  {
    id: 'dusk',
    label: 'Dusk',
    description: 'Plum and rose after sunset, a soft serif clock and a dithered sky. Light mode is dawn on cream.',
    // Instrument Sans for the interface (a warm, slightly narrow grotesque), Fraunces — set soft — for the clock and page titles.
    bundle: { accent: { kind: 'custom', hex: DUSK_ROSE }, font: 'instrument-sans', monoFont: 'geist-mono', radius: 'lg' },
    fonts: ['fraunces'],
    // Keep in step with the tokens in styles/dusk.css (a test compares them): background, card, popover, muted, secondary.
    surfaces: {
      light: ['#faf4ed', '#fffaf3', '#fffdf9', '#f2e9e1', '#ebe1d8'],
      dark: ['#191724', '#1f1d2e', '#26233a', '#2a273f', '#322e49'],
    },
    wallpaper: {
      scene: 'dusk',
      label: 'Dithered Dusk',
      description: 'Layered ridgelines under a dithered sunset sky, with drifting clouds and stars. Dawn in light mode.',
    },
    preview: {
      light: { bg: '#faf4ed', card: '#fffaf3', ink: '#46415f', muted: '#5c5877', line: 'rgb(110 80 120 / 18%)' },
      dark: { bg: '#191724', card: '#1f1d2e', ink: '#e6e2f4', muted: '#aca8c6', line: 'rgb(214 184 232 / 16%)' },
      texture: 'none',
      // the real Dithered Dusk still (features/stylewall) is the picture behind the little Home
      wallpaperStill: true,
      displayFont: 'fraunces',
      displayWeight: 360,
      displayVariation: "'SOFT' 100, 'WONK' 0",
      pill: true,
    },
  },
];

export const themeStyleById = (id: unknown): ThemeStyleDef => THEME_STYLES.find((s) => s.id === id) ?? (THEME_STYLES[0] as ThemeStyleDef);

/** The wallpaper entry of a style (undefined for a style without one). */
export const styleWallpaperDef = (id: unknown): StyleWallpaperDef | undefined => themeStyleById(coerceThemeStyle(id)).wallpaper;

/**
 * The style wallpaper that is painting right now, or null: the style has one, the "Style wallpaper" setting is on, and the user has not
 * picked a wallpaper of their own (a colour, gradient, mesh or picture always wins).
 */
export function activeStyleWallpaper(style: unknown, wallpaper: Wallpaper, enabled: boolean): StyleWallpaperDef | null {
  return enabled && wallpaper.kind === 'none' ? (styleWallpaperDef(style) ?? null) : null;
}

/** A stored plate id → one the style offers (the first, i.e. the default, for anything unknown). '' for a style without plates. */
export function coercePlate(style: unknown, plate: unknown): string {
  const plates = styleWallpaperDef(style)?.plates;
  if (!plates?.length) return '';
  return plates.find((p) => p.id === plate)?.id ?? (plates[0] as { id: string }).id;
}

/** The settings a style puts in place when picked (a copy, safe to spread into the store). */
export const styleBundle = (id: unknown): StyleBundle => ({ ...themeStyleById(id).bundle });

/** The style's own surfaces as the accent pipeline wants them (undefined for a style that keeps the stock ones). */
export function styleSurfaces(id: unknown): TextSurfaces | undefined {
  const surfaces = themeStyleById(coerceThemeStyle(id)).surfaces;
  if (!surfaces) return undefined;
  const toOklch = (hex: string) => rgbToOklch(parseHex(hex) ?? { r: 255, g: 255, b: 255 });
  return { light: surfaces.light.map(toOklch), dark: surfaces.dark.map(toOklch) };
}

/**
 * CSS variables a style's layer reads that the appearance pipeline owns: today the display font (`--pact-font-display`).
 * '' for Default, so the stock look adds nothing.
 */
export function styleCss(id: unknown): string {
  const style = themeStyleById(coerceThemeStyle(id));
  const [display, ...others] = style.fonts.map((f) => fontById(f)).filter((f) => f?.category === 'display');
  // The first display face is `--pact-font-display`; a style with a second one gets `--pact-font-<id>`.
  return display ? `html:root{--pact-font-display:${fontStack(display)}${others.map((f) => (f ? `;--pact-font-${f.id}:${fontStack(f)}` : '')).join('')}}` : '';
}
