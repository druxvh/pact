import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PLATES } from '@/features/stylewall/plates';
import { hasScene } from '@/features/stylewall/registry';
import { APPEARANCE_DEFAULTS, useAppearanceStore } from '@/store/useAppearanceStore';
import { appearanceCss, applyAppearance, BOOT_KEY, wallpaperMode, wallpaperVarsCss } from './apply';
import { activeStyleWallpaper, coercePlate, styleWallpaperDef, THEME_STYLES } from './themeStyle';
import { NO_WALLPAPER, uniformDim } from './wallpaper';

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');

describe('style wallpapers in the registry', () => {
  it('Default and Dot Matrix have none; Ultramarine and Dusk have a wallpaper with a real scene', () => {
    expect(styleWallpaperDef('default')).toBeUndefined();
    expect(styleWallpaperDef('dotmatrix')).toBeUndefined();
    for (const id of ['ultramarine', 'dusk']) {
      const w = styleWallpaperDef(id);
      expect(w, id).toBeDefined();
      expect(hasScene(w?.scene ?? ''), id).toBe(true);
    }
  });

  it('every scene id in the registry is loadable, and every plate a style offers has an image', () => {
    for (const s of THEME_STYLES) {
      if (!s.wallpaper) continue;
      expect(hasScene(s.wallpaper.scene)).toBe(true);
      for (const p of s.wallpaper.plates ?? []) expect(PLATES[p.id], `${s.id}:${p.id}`).toBeDefined();
    }
  });

  it('a style wallpaper paints only when the style has one, it is on, and the user has no wallpaper of their own', () => {
    expect(activeStyleWallpaper('dusk', NO_WALLPAPER, true)?.scene).toBe('dusk');
    expect(activeStyleWallpaper('dusk', NO_WALLPAPER, false)).toBeNull();
    expect(activeStyleWallpaper('dusk', { kind: 'solid', color: '#112233' }, true)).toBeNull();
    expect(activeStyleWallpaper('dusk', { kind: 'image', id: 'wallpaper-image', name: 'x' }, true)).toBeNull();
    expect(activeStyleWallpaper('default', NO_WALLPAPER, true)).toBeNull();
    expect(activeStyleWallpaper('nonsense', NO_WALLPAPER, true)).toBeNull();
  });

  it('coercePlate keeps an offered plate and falls back to the first; styles without plates have none', () => {
    const first = styleWallpaperDef('ultramarine')?.plates?.[0]?.id;
    expect(first).toBeTruthy();
    expect(coercePlate('ultramarine', first)).toBe(first);
    expect(coercePlate('ultramarine', 'garbage')).toBe(first);
    expect(coercePlate('ultramarine', undefined)).toBe(first);
    expect(coercePlate('dusk', 'halo')).toBe('');
    expect(coercePlate('default', 'halo')).toBe('');
  });
});

describe('what the page is told (apply.ts)', () => {
  it('data-wallpaper is "style" for a style wallpaper, and the user wallpaper kinds are unchanged', () => {
    expect(wallpaperMode(NO_WALLPAPER, true)).toBe('style');
    expect(wallpaperMode(NO_WALLPAPER, false)).toBe('');
    expect(wallpaperMode(NO_WALLPAPER)).toBe('');
    expect(wallpaperMode({ kind: 'solid', color: '#fff' }, true)).toBe('color');
    expect(wallpaperMode({ kind: 'image', id: 'a', name: 'b' }, true)).toBe('image');
  });

  it('the Dim slider drives --wp-dim for a style wallpaper too (the scrim reads it)', () => {
    expect(wallpaperVarsCss(NO_WALLPAPER, uniformDim(0))).toBe('');
    const css = wallpaperVarsCss(NO_WALLPAPER, { light: 10, dark: 35 }, true);
    expect(css).toContain('--wp-dim:0.10');
    expect(css).toContain('html.dark{--wp-dim:0.35}');
    expect(css).not.toContain('--wp-bg'); // no CSS background: the canvas paints it
  });

  beforeEach(() => {
    localStorage.clear();
    document.getElementById('pact-appearance')?.remove();
    delete document.documentElement.dataset.wallpaper;
    delete document.documentElement.dataset.style;
  });

  it('applyAppearance sets data-wallpaper="style" with the style, caches it for first paint, and clears it when the user picks a colour', () => {
    const state = { ...APPEARANCE_DEFAULTS, style: 'dusk' as const, styleWallpaper: true };
    applyAppearance(state);
    expect(document.documentElement.dataset.wallpaper).toBe('style');
    expect(document.documentElement.dataset.style).toBe('dusk');
    expect(JSON.parse(localStorage.getItem(BOOT_KEY) ?? '{}').mode).toBe('style');

    applyAppearance({ ...state, wallpaper: { kind: 'solid' as const, color: '#101820' } });
    expect(document.documentElement.dataset.wallpaper).toBe('color');

    applyAppearance({ ...state, styleWallpaper: false });
    expect(document.documentElement.dataset.wallpaper).toBeUndefined();
    expect(appearanceCss({ ...state, styleWallpaper: false })).not.toContain('--wp-dim');
  });

  it('Default never gets a style wallpaper, whatever the setting', () => {
    applyAppearance({ ...APPEARANCE_DEFAULTS, styleWallpaper: true });
    expect(document.documentElement.dataset.wallpaper).toBeUndefined();
  });
});

describe('the setting', () => {
  beforeEach(() => {
    useAppearanceStore.setState({ ...APPEARANCE_DEFAULTS });
  });

  it('is on by default and switched on again whenever a style is picked', () => {
    expect(useAppearanceStore.getState().styleWallpaper).toBe(true);
    useAppearanceStore.getState().setStyle('dusk');
    useAppearanceStore.getState().setStyleWallpaper(false);
    expect(useAppearanceStore.getState().styleWallpaper).toBe(false);
    useAppearanceStore.getState().setStyle('ultramarine');
    expect(useAppearanceStore.getState().styleWallpaper).toBe(true);
    expect(useAppearanceStore.getState().plate).toBe(coercePlate('ultramarine', ''));
  });

  it('picking the style that is already on changes nothing (a switched-off wallpaper stays off)', () => {
    useAppearanceStore.getState().setStyle('dusk');
    useAppearanceStore.getState().setStyleWallpaper(false);
    useAppearanceStore.getState().setStyle('dusk');
    expect(useAppearanceStore.getState().styleWallpaper).toBe(false);
  });

  it('only accepts the plates the style offers', () => {
    useAppearanceStore.getState().setStyle('ultramarine');
    useAppearanceStore.getState().setPlate('made-up');
    expect(useAppearanceStore.getState().plate).toBe(coercePlate('ultramarine', ''));
  });

  it('Reset returns to Default with the wallpaper setting at its default', () => {
    useAppearanceStore.getState().setStyle('dusk');
    useAppearanceStore.getState().setStyleWallpaper(false);
    useAppearanceStore.getState().resetAppearance();
    expect(useAppearanceStore.getState().style).toBe('default');
    expect(useAppearanceStore.getState().styleWallpaper).toBe(true);
  });
});

describe('the CSS contract (src/styles/stylewall.css)', () => {
  const css = read('../../styles/stylewall.css');
  it('documents and implements every variable the README promises', () => {
    const readme = read('../../features/stylewall/README.md');
    for (const v of ['--sw-card', '--sw-blur', '--sw-scrim', '--sw-scrim-edge', '--sw-canvas-opacity', '--sw-bg']) {
      expect(css, v).toContain(v);
      expect(readme, v).toContain(v);
    }
    expect(css).toContain('.stylewall-scrim');
    expect(css).toContain('--wp-dim');
  });
  it('globals.css lets cards read the contract variables and imports the layer', () => {
    const globals = read('../../styles/globals.css');
    expect(globals).toContain("@import './stylewall.css'");
    expect(globals).toContain('var(--sw-card, 82%)');
    expect(globals).toContain('var(--sw-blur, 14px)');
  });
  it('a stylesheet only reaches the canvas while the style wallpaper is on, and the canvas stills its fade for reduced motion', () => {
    expect(css).toContain("html[data-wallpaper='style']");
    expect(css).toContain("html[data-motion='reduced'] .stylewall > canvas");
  });
});
