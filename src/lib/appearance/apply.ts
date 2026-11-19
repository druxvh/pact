/**
 * Turns the appearance settings into live CSS.
 *
 * One <style id="pact-appearance"> holds the accent tokens, font variables, corner-radius variables and wallpaper variables. A copy is cached
 * in localStorage (`pact-appearance-boot`) which public/theme-init.js applies before first paint, so your style, accent,
 * font, roundness and colour/gradient wallpaper are in place the moment the tab appears — no orange-then-blue flash.
 * The theme *style* is also written to <html data-style>, which switches on that style's CSS layer (styles/<id>.css).
 */
import type { AppearanceState } from '@/store/useAppearanceStore';
import { accentCss } from './accent';
import { currentFaviconHref, STOCK_ICON, setFavicon } from './favicon';
import { ensureFont, fontCss } from './fontLoader';
import { fontById, fontVarsCss } from './fonts';
import { radiusCss } from './radius';
import { activeStyleWallpaper, coerceThemeStyle, DEFAULT_THEME_STYLE, styleCss, styleSurfaces, themeStyleById } from './themeStyle';
import { type Dim, type Wallpaper, wallpaperBackground } from './wallpaper';

export const BOOT_KEY = 'pact-appearance-boot';
const STYLE_ID = 'pact-appearance';

type Snapshot = Pick<AppearanceState, 'style' | 'accent' | 'font' | 'monoFont' | 'radius' | 'wallpaper' | 'dim'> & { styleWallpaper?: boolean };

/**
 * `color` = painted by CSS on <body> (instant); `image` = painted by the <WallpaperLayer> component; `style` = the theme style's own animated
 * wallpaper, painted by <StyleWallpaper> (features/stylewall) — only when no wallpaper of the user's own is chosen.
 */
export const wallpaperMode = (wp: Wallpaper, styleActive = false): 'color' | 'image' | 'style' | '' =>
  wp.kind === 'none' ? (styleActive ? 'style' : '') : wp.kind === 'image' ? 'image' : 'color';

const frac = (n: number) => (n / 100).toFixed(2);

/** The dim differs per theme, so it's emitted under both selectors (`html.dark` comes last and wins in dark). */
export function wallpaperVarsCss(wp: Wallpaper, dim: Dim, styleActive = false): string {
  if (wp.kind === 'none') return styleActive ? `html:root{--wp-dim:${frac(dim.light)}}html.dark{--wp-dim:${frac(dim.dark)}}` : '';
  const bg = wallpaperBackground(wp);
  return `html:root{--wp-dim:${frac(dim.light)}${bg ? `;--wp-bg:${bg}` : ''}}html.dark{--wp-dim:${frac(dim.dark)}}`;
}

const styleWallpaperOn = (s: Snapshot): boolean => activeStyleWallpaper(s.style, s.wallpaper, s.styleWallpaper ?? true) !== null;

export function appearanceCss(s: Snapshot): string {
  return (
    accentCss(s.accent, styleSurfaces(s.style)) +
    fontVarsCss(s.font, s.monoFont) +
    radiusCss(s.radius) +
    styleCss(s.style) +
    wallpaperVarsCss(s.wallpaper, s.dim, styleWallpaperOn(s))
  );
}

function styleEl(): HTMLStyleElement {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.append(el);
  }
  return el;
}

let lastFontCss = '';

function writeBoot(css: string, mode: string, icon: string, style: string) {
  try {
    localStorage.setItem(
      BOOT_KEY,
      JSON.stringify({ css, mode, fonts: lastFontCss, icon: icon === STOCK_ICON ? undefined : icon, style: style === DEFAULT_THEME_STYLE ? undefined : style }),
    );
  } catch {
    /* storage full or blocked — the app still works, just with a first-paint flash */
  }
}

export function applyAppearance(s: Snapshot): void {
  const style = coerceThemeStyle(s.style);
  const css = appearanceCss(s);
  const mode = wallpaperMode(s.wallpaper, styleWallpaperOn(s));
  styleEl().textContent = css;
  if (mode) document.documentElement.dataset.wallpaper = mode;
  else delete document.documentElement.dataset.wallpaper;
  if (style === DEFAULT_THEME_STYLE) delete document.documentElement.dataset.style;
  else document.documentElement.dataset.style = style;
  const icon = currentFaviconHref(s.accent);
  setFavicon(icon);
  writeBoot(css, mode, icon, style);

  // Fonts load lazily; once their @font-face CSS is known, cache it for the next boot too. A style's display font comes along.
  const wanted = [s.font, s.monoFont, ...themeStyleById(style).fonts].map((id) => fontById(id)).filter((f) => f && !f.builtIn);
  void Promise.all(
    wanted.map(async (f) => {
      if (!f) return '';
      await ensureFont(f.id);
      return fontCss(f);
    }),
  ).then((faces) => {
    lastFontCss = faces.join('');
    writeBoot(css, mode, icon, style);
  });
}

let started = false;

/** Apply now and whenever the settings change (call once at startup). */
export async function startAppearance(): Promise<void> {
  if (started) return;
  started = true;
  const { useAppearanceStore } = await import('@/store/useAppearanceStore');
  applyAppearance(useAppearanceStore.getState());
  useAppearanceStore.subscribe((state, prev) => {
    if (
      state.style !== prev.style ||
      state.accent !== prev.accent ||
      state.font !== prev.font ||
      state.monoFont !== prev.monoFont ||
      state.radius !== prev.radius ||
      state.wallpaper !== prev.wallpaper ||
      state.styleWallpaper !== prev.styleWallpaper ||
      state.dim !== prev.dim
    ) {
      applyAppearance(state);
    }
  });
}
