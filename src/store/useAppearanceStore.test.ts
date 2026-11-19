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
    expect(s.radius).toBe('md');
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

describe('roundness', () => {
  beforeEach(() => localStorage.clear());

  it('a v2 store (from before the setting existed) upgrades to the stock roundness and keeps everything else', async () => {
    localStorage.setItem(
      'pact-appearance',
      JSON.stringify({ state: { accent: { kind: 'preset', id: 'blue' }, font: 'inter', dim: { light: 10, dark: 20 } }, version: 2 }),
    );
    const s = (await loadStore()).getState();
    expect(s.radius).toBe('md');
    expect(s.accent).toEqual({ kind: 'preset', id: 'blue' });
    expect(s.font).toBe('inter');
    expect(s.dim).toEqual({ light: 10, dark: 20 });
  });

  it('a v1 store goes through both migrations', async () => {
    localStorage.setItem('pact-appearance', JSON.stringify({ state: { dim: 40 }, version: 1 }));
    const s = (await loadStore()).getState();
    expect(s.dim).toEqual({ light: 40, dark: 40 });
    expect(s.radius).toBe('md');
  });

  it('keeps a saved v3 roundness', async () => {
    localStorage.setItem('pact-appearance', JSON.stringify({ state: { radius: 'none' }, version: 3 }));
    expect((await loadStore()).getState().radius).toBe('none');
  });

  it('setRadius stores the choice, persists it, ignores nonsense, and Reset puts the stock look back', async () => {
    const store = await loadStore();
    store.getState().setRadius('lg');
    expect(store.getState().radius).toBe('lg');
    expect(JSON.parse(localStorage.getItem('pact-appearance') ?? '{}').state.radius).toBe('lg');
    store.getState().setRadius('huge' as never);
    expect(store.getState().radius).toBe('md');
    store.getState().setRadius('sm');
    store.getState().resetAppearance();
    expect(store.getState().radius).toBe('md');
  });

  it('is included in the persisted fields', async () => {
    const store = await loadStore();
    const part = store.persist.getOptions().partialize?.(store.getState());
    expect(part).toHaveProperty('radius', 'md');
    expect(store.persist.getOptions().version).toBe(4);
  });
});

describe('theme style and search bar effect', () => {
  beforeEach(() => localStorage.clear());
  const persisted = () => JSON.parse(localStorage.getItem('pact-appearance') ?? '{}');

  it('start as Default and no effect', async () => {
    const s = (await loadStore()).getState();
    expect(s.style).toBe('default');
    expect(s.omniEffect).toBe('none');
  });

  it('a v3 store (from before both existed) upgrades to Default / none and keeps everything else', async () => {
    localStorage.setItem(
      'pact-appearance',
      JSON.stringify({ state: { accent: { kind: 'preset', id: 'blue' }, font: 'inter', radius: 'lg', dim: { light: 5, dark: 9 } }, version: 3 }),
    );
    const s = (await loadStore()).getState();
    expect(s.style).toBe('default');
    expect(s.omniEffect).toBe('none');
    expect(s.accent).toEqual({ kind: 'preset', id: 'blue' });
    expect(s.font).toBe('inter');
    expect(s.radius).toBe('lg');
    expect(s.dim).toEqual({ light: 5, dark: 9 });
  });

  it('an old v1 store goes through every migration', async () => {
    localStorage.setItem('pact-appearance', JSON.stringify({ state: { dim: 40 }, version: 1 }));
    const s = (await loadStore()).getState();
    expect(s.dim).toEqual({ light: 40, dark: 40 });
    expect(s.radius).toBe('md');
    expect(s.style).toBe('default');
    expect(s.omniEffect).toBe('none');
  });

  it('keeps a saved v4 style and effect', async () => {
    localStorage.setItem('pact-appearance', JSON.stringify({ state: { style: 'dotmatrix', omniEffect: 'fire' }, version: 4 }));
    const s = (await loadStore()).getState();
    expect(s.style).toBe('dotmatrix');
    expect(s.omniEffect).toBe('fire');
  });

  it('unknown or corrupt stored values coerce to the stock choice (they never reach the CSS)', async () => {
    localStorage.setItem('pact-appearance', JSON.stringify({ state: { style: 'vaporwave', omniEffect: 'plasma', radius: 'xl' }, version: 4 }));
    const s = (await loadStore()).getState();
    expect(s.style).toBe('default');
    expect(s.omniEffect).toBe('none');
    expect(s.radius).toBe('md');
    localStorage.setItem('pact-appearance', JSON.stringify({ state: { style: { evil: 1 }, omniEffect: ['beam'] }, version: 4 }));
    const t = (await loadStore()).getState();
    expect(t.style).toBe('default');
    expect(t.omniEffect).toBe('none');
  });

  it('picking Dot Matrix applies its bundle once; tweaks afterwards keep the style', async () => {
    const store = await loadStore();
    store.getState().setAccent({ kind: 'preset', id: 'blue' });
    store.getState().setStyle('dotmatrix');
    const s = store.getState();
    expect(s.style).toBe('dotmatrix');
    expect(s.accent).toEqual({ kind: 'custom', hex: '#D71921' });
    expect(s.font).toBe('space-grotesk');
    expect(s.monoFont).toBe('space-mono');
    expect(s.radius).toBe('sm');
    // the user keeps control of every part of the bundle
    store.getState().setAccent({ kind: 'preset', id: 'teal' });
    store.getState().setFont('inter');
    store.getState().setRadius('lg');
    expect(store.getState().style).toBe('dotmatrix');
    expect(store.getState().accent).toEqual({ kind: 'preset', id: 'teal' });
    // picking the style that is already on is a no-op (your tweaks survive a stray click)
    store.getState().setStyle('dotmatrix');
    expect(store.getState().accent).toEqual({ kind: 'preset', id: 'teal' });
    expect(store.getState().font).toBe('inter');
    expect(persisted().state.style).toBe('dotmatrix');
  });

  it('picking Default again restores the stock accent, fonts and roundness; wallpaper is never touched', async () => {
    const store = await loadStore();
    store.getState().setWallpaper({ kind: 'solid', color: '#101010' });
    store.getState().setStyle('dotmatrix');
    store.getState().setStyle('default');
    const s = store.getState();
    expect(s.style).toBe('default');
    expect(s.accent).toEqual({ kind: 'preset', id: 'orange' });
    expect(s.font).toBe('geist');
    expect(s.monoFont).toBe('geist-mono');
    expect(s.radius).toBe('md');
    expect(s.wallpaper).toEqual({ kind: 'solid', color: '#101010' });
  });

  it('setStyle and setOmniEffect ignore nonsense', async () => {
    const store = await loadStore();
    store.getState().setStyle('neon-noir' as never);
    expect(store.getState().style).toBe('default');
    store.getState().setOmniEffect('beam');
    expect(store.getState().omniEffect).toBe('beam');
    store.getState().setOmniEffect('sparkles' as never);
    expect(store.getState().omniEffect).toBe('none');
  });

  it('Reset returns to Default and no effect', async () => {
    const store = await loadStore();
    store.getState().setStyle('dotmatrix');
    store.getState().setOmniEffect('electric');
    store.getState().resetAppearance();
    const s = store.getState();
    expect(s.style).toBe('default');
    expect(s.omniEffect).toBe('none');
    expect(s.accent).toEqual({ kind: 'preset', id: 'orange' });
    expect(s.radius).toBe('md');
  });

  it('both are persisted', async () => {
    const store = await loadStore();
    store.getState().setStyle('dotmatrix');
    store.getState().setOmniEffect('haze');
    const part = store.persist.getOptions().partialize?.(store.getState());
    expect(part).toHaveProperty('style', 'dotmatrix');
    expect(part).toHaveProperty('omniEffect', 'haze');
    expect(persisted().state).toMatchObject({ style: 'dotmatrix', omniEffect: 'haze' });
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
