import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadStore() {
  vi.resetModules();
  return (await import('./useThemeStore')).useThemeStore;
}

describe('useThemeStore hydration', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
  });

  it('resolves a persisted light mode to light (not the dark default)', async () => {
    localStorage.setItem('pact-theme', JSON.stringify({ state: { mode: 'light' }, version: 2 }));
    const store = await loadStore();
    expect(store.getState().mode).toBe('light');
    expect(store.getState().resolved).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('resolves a persisted dark mode to dark and paints it', async () => {
    localStorage.setItem('pact-theme', JSON.stringify({ state: { mode: 'dark' }, version: 2 }));
    const store = await loadStore();
    expect(store.getState().resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('defaults to dark with nothing stored, and the first toggle after a light reload goes to dark', async () => {
    expect((await loadStore()).getState().resolved).toBe('dark');
    localStorage.setItem('pact-theme', JSON.stringify({ state: { mode: 'light' }, version: 2 }));
    const store = await loadStore();
    store.getState().toggle();
    expect(store.getState().resolved).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
