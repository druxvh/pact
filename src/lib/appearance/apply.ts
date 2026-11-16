/**
 * Turns the appearance settings into live CSS.
 *
 * One <style id="pact-appearance"> holds the accent tokens, font variables and wallpaper variables. A copy is cached
 * in localStorage (`pact-appearance-boot`) which public/theme-init.js applies before first paint, so your accent,
 * font and colour/gradient wallpaper are in place the moment the tab appears — no orange-then-blue flash.
 */
import type { AppearanceState } from '@/store/useAppearanceStore';
import { accentCss } from './accent';
import { ensureFont, fontCss } from './fontLoader';
import { fontById, fontVarsCss } from './fonts';
import { type Wallpaper, wallpaperBackground } from './wallpaper';

export const BOOT_KEY = 'pact-appearance-boot';
const STYLE_ID = 'pact-appearance';

type Snapshot = Pick<AppearanceState, 'accent' | 'font' | 'monoFont' | 'wallpaper' | 'dim'>;

/** `color` = painted by CSS on <body> (instant); `image` = painted by the <WallpaperLayer> component. */
export const wallpaperMode = (wp: Wallpaper): 'color' | 'image' | '' => (wp.kind === 'none' ? '' : wp.kind === 'image' ? 'image' : 'color');

export function wallpaperVarsCss(wp: Wallpaper, dim: number): string {
  if (wp.kind === 'none') return '';
  const bg = wallpaperBackground(wp);
  return `html:root{--wp-dim:${(dim / 100).toFixed(2)}${bg ? `;--wp-bg:${bg}` : ''}}`;
}

export function appearanceCss(s: Snapshot): string {
  return accentCss(s.accent) + fontVarsCss(s.font, s.monoFont) + wallpaperVarsCss(s.wallpaper, s.dim);
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

function writeBoot(css: string, mode: string) {
  try {
    localStorage.setItem(BOOT_KEY, JSON.stringify({ css, mode, fonts: lastFontCss }));
  } catch {
    /* storage full or blocked — the app still works, just with a first-paint flash */
  }
}

export function applyAppearance(s: Snapshot): void {
  const css = appearanceCss(s);
  const mode = wallpaperMode(s.wallpaper);
  styleEl().textContent = css;
  if (mode) document.documentElement.dataset.wallpaper = mode;
  else delete document.documentElement.dataset.wallpaper;
  writeBoot(css, mode);

  // Fonts load lazily; once their @font-face CSS is known, cache it for the next boot too.
  const wanted = [s.font, s.monoFont].map((id) => fontById(id)).filter((f) => f && !f.builtIn);
  void Promise.all(
    wanted.map(async (f) => {
      if (!f) return '';
      await ensureFont(f.id);
      return fontCss(f);
    }),
  ).then((faces) => {
    lastFontCss = faces.join('');
    writeBoot(css, mode);
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
      state.accent !== prev.accent ||
      state.font !== prev.font ||
      state.monoFont !== prev.monoFont ||
      state.wallpaper !== prev.wallpaper ||
      state.dim !== prev.dim
    ) {
      applyAppearance(state);
    }
  });
}
