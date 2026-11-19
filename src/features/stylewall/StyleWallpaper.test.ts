import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPEARANCE_DEFAULTS, useAppearanceStore } from '@/store/useAppearanceStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useThemeStore } from '@/store/useThemeStore';
import { activeCount } from './loop';
import { fakeContext } from './testUtil';
import type { Scene, SceneFactory, SceneOptions } from './types';

const created: Array<{ id: string; options: SceneOptions; disposed: boolean; frames: number }> = [];

const factoryFor =
  (id: string): SceneFactory =>
  ({ options }) => {
    const rec = { id, options, disposed: false, frames: 0 };
    created.push(rec);
    const scene: Scene = {
      fps: 30,
      stillTime: 1,
      size: (vw, vh) => ({ w: vw, h: vh, smooth: true }),
      resize: () => {},
      frame: () => {
        rec.frames++;
      },
      dispose: () => {
        rec.disposed = true;
      },
    };
    return scene;
  };

vi.mock('./registry', () => ({
  hasScene: (id: string) => id === 'dusk' || id === 'ultramarine',
  loadScene: (id: string) => Promise.resolve(factoryFor(id)),
}));

let root: Root;
let host: HTMLElement;
let raf: Array<FrameRequestCallback> = [];

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  created.length = 0;
  raf = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => raf.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => fakeContext()) as never);
  useAppearanceStore.setState({ ...APPEARANCE_DEFAULTS });
  useSettingsStore.setState({ motion: 'full' });
  useThemeStore.setState({ resolved: 'dark' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const { StyleWallpaper } = await import('./StyleWallpaper');
  await act(async () => {
    root.render(createElement(StyleWallpaper));
  });
  await flush();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const layer = () => host.querySelector('.stylewall');
const pick = async (patch: Partial<typeof APPEARANCE_DEFAULTS>) => {
  await act(async () => {
    useAppearanceStore.setState(patch);
  });
  await flush();
};

describe('<StyleWallpaper />', () => {
  it('renders nothing for Default, which has no wallpaper (and loads no scene)', () => {
    expect(layer()).toBeNull();
    expect(created).toHaveLength(0);
  });

  it('paints a style that has one: the layer, its canvas and scrim, the scene id, and fades in after the first frame', async () => {
    await pick({ style: 'dusk' });
    const el = layer();
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-stylewall')).toBe('dusk');
    expect(el?.getAttribute('aria-hidden')).toBe('true');
    expect(el?.querySelector('canvas')).not.toBeNull();
    expect(el?.querySelector('.stylewall-scrim')).not.toBeNull();
    expect(created).toHaveLength(1);
    expect(created[0]?.frames).toBeGreaterThanOrEqual(1);
    expect(el?.hasAttribute('data-ready')).toBe(true);
    expect(created[0]?.options.dark).toBe(1);
  });

  it('switching style tears the old scene down completely and builds the new one', async () => {
    await pick({ style: 'dusk' });
    await pick({ style: 'ultramarine' });
    expect(created.map((c) => c.id)).toEqual(['dusk', 'ultramarine']);
    expect(created[0]?.disposed).toBe(true);
    expect(created[1]?.disposed).toBe(false);
    expect(layer()?.getAttribute('data-stylewall')).toBe('ultramarine');
    expect(activeCount()).toBe(1); // one subscriber on the shared loop, not two
  });

  it("a wallpaper of the user's own wins: the scene is removed and disposed; Style wallpaper off does the same", async () => {
    await pick({ style: 'dusk' });
    await pick({ wallpaper: { kind: 'solid', color: '#102030' } });
    expect(layer()).toBeNull();
    expect(created[0]?.disposed).toBe(true);
    expect(activeCount()).toBe(0);

    await pick({ wallpaper: { kind: 'none' } });
    expect(layer()).not.toBeNull();
    await pick({ styleWallpaper: false });
    expect(layer()).toBeNull();
    expect(created.every((c) => c.disposed)).toBe(true);
    expect(activeCount()).toBe(0);
  });

  it('follows light/dark and the accent without rebuilding the scene', async () => {
    await pick({ style: 'ultramarine' });
    const first = created[0];
    await act(async () => {
      useThemeStore.setState({ resolved: 'light' });
    });
    await act(async () => {
      useAppearanceStore.setState({ accent: { kind: 'custom', hex: '#2fc460' } });
    });
    expect(created).toHaveLength(1);
    expect(first?.options.accent.toLowerCase()).toBe('#2fc460');
  });

  it('with reduced motion (the in-app setting) draws one still frame and runs nothing; "full" overrides the OS preference', async () => {
    await act(async () => {
      useSettingsStore.setState({ motion: 'reduced' });
    });
    await pick({ style: 'dusk' });
    expect(created[0]?.frames).toBe(1);
    expect(activeCount()).toBe(0);
    expect(created[0]?.options.still).toBe(true);
    await act(async () => {
      useSettingsStore.setState({ motion: 'full' });
    });
    expect(created[0]?.options.still).toBe(false);
    expect(activeCount()).toBe(1);
  });

  it('with the OS asking for reduced motion and the setting on "system", it is still too', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    await act(async () => {
      useSettingsStore.setState({ motion: 'system' });
    });
    await pick({ style: 'dusk' });
    expect(created[0]?.options.still).toBe(true);
    expect(activeCount()).toBe(0);
  });
});
