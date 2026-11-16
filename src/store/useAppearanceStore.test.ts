import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wallpaperVarsCss } from '@/lib/appearance/apply';

async function loadStore() {
  vi.resetModules();
  return (await import('./useAppearanceStore')).useAppearanceStore;
}

describe('useAppearanceStore', () => {
  beforeEach(() => localStorage.clear());

  it('starts with the stock look', async () => {
    const s = (await loadStore()).getState();
    expect(s.accent).toEqual({ kind: 'preset', id: 'orange' });
    expect(s.wallpaper).toEqual({ kind: 'none' });
    expect(s.dim).toEqual({ light: 0, dark: 0 });
  });

  it('migrates a v1 single dim to both themes', async () => {
    localStorage.setItem(
      'pact-appearance',
      JSON.stringify({ state: { accent: { kind: 'preset', id: 'blue' }, wallpaper: { kind: 'mesh', id: 'nebula' }, dim: 40, blur: 0 }, version: 1 }),
    );
    const s = (await loadStore()).getState();
    expect(s.dim).toEqual({ light: 40, dark: 40 });
    expect(s.accent).toEqual({ kind: 'preset', id: 'blue' });
  });

  it('keeps a v2 per-theme dim as it is', async () => {
    localStorage.setItem(
      'pact-appearance',
      JSON.stringify({ state: { wallpaper: { kind: 'solid', color: '#101010' }, dim: { light: 65, dark: 0 } }, version: 2 }),
    );
    expect((await loadStore()).getState().dim).toEqual({ light: 65, dark: 0 });
  });

  it('sets and clamps each theme independently', async () => {
    const store = await loadStore();
    store.getState().setDim('light', 65);
    store.getState().setDim('dark', 500);
    expect(store.getState().dim).toEqual({ light: 65, dark: 80 });
    store.getState().setDim('light', -10);
    expect(store.getState().dim).toEqual({ light: 0, dark: 80 });
  });

  it('setDims sets both, and a new kind of wallpaper resets to that kind’s default', async () => {
    const store = await loadStore();
    store.getState().setDims({ light: 30, dark: 5 });
    expect(store.getState().dim).toEqual({ light: 30, dark: 5 });
    store.getState().setWallpaper({ kind: 'solid', color: '#000000' });
    const d = store.getState().dim;
    expect(d.light).toBe(d.dark); // a uniform default
    store.getState().setDims({ light: 50, dark: 10 });
    store.getState().setWallpaper({ kind: 'solid', color: '#ffffff' }); // same kind → keep the user's dims
    expect(store.getState().dim).toEqual({ light: 50, dark: 10 });
  });

  it('reset restores the defaults', async () => {
    const store = await loadStore();
    store.getState().setAccent({ kind: 'custom', hex: '#123456' });
    store.getState().setDims({ light: 20, dark: 20 });
    store.getState().resetAppearance();
    expect(store.getState().accent).toEqual({ kind: 'preset', id: 'orange' });
    expect(store.getState().dim).toEqual({ light: 0, dark: 0 });
  });
});

describe('wallpaperVarsCss', () => {
  it('emits nothing without a wallpaper', () => {
    expect(wallpaperVarsCss({ kind: 'none' }, { light: 0, dark: 0 })).toBe('');
  });
  it('sets the background once and the dim separately for light and dark', () => {
    const css = wallpaperVarsCss({ kind: 'solid', color: '#123456' }, { light: 65, dark: 5 });
    expect(css).toBe('html:root{--wp-dim:0.65;--wp-bg:#123456}html.dark{--wp-dim:0.05}');
    expect(css.indexOf('html.dark')).toBeGreaterThan(css.indexOf('html:root')); // dark must come last to win
  });
  it('an image wallpaper has no --wp-bg (the layer paints it) but still has both dims', () => {
    expect(wallpaperVarsCss({ kind: 'image', id: 'x', name: 'x' }, { light: 40, dark: 20 })).toBe('html:root{--wp-dim:0.40}html.dark{--wp-dim:0.20}');
  });
});
