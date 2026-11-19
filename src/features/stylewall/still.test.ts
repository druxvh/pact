import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeContext } from './testUtil';
import type { Scene, SceneFactory } from './types';

const calls: string[] = [];
let readyResolve: () => void = () => {};

const fakeFactory: SceneFactory = () => {
  const scene: Scene = {
    fps: 30,
    stillTime: 7,
    ready: new Promise<void>((r) => {
      readyResolve = r;
    }),
    size: (vw, vh, dpr) => {
      calls.push(`size ${vw}x${vh}@${dpr}`);
      return { w: vw, h: vh, smooth: true };
    },
    resize: (w, h) => {
      calls.push(`resize ${w}x${h}`);
    },
    frame: (t) => {
      calls.push(`frame ${t}`);
    },
    dispose: () => {
      calls.push('dispose');
    },
  };
  return scene;
};

vi.mock('./registry', () => ({ loadScene: (id: string) => Promise.resolve(id === 'fake' ? fakeFactory : null) }));

beforeEach(() => {
  calls.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => fakeContext()) as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => 'data:image/webp;base64,AAAA');
});
afterEach(() => vi.restoreAllMocks());

describe('renderStill', () => {
  it('draws the real scene once, after its assets are ready, at a roomy virtual viewport, then lets go of it', async () => {
    const { renderStill, clearStills } = await import('./still');
    clearStills();
    const p = renderStill({ scene: 'fake', w: 152, h: 104, dark: true });
    await vi.waitFor(() => expect(calls.some((c) => c.startsWith('resize'))).toBe(true));
    expect(calls).toContain('size 480x328@1'); // 152×104 scaled up to ≥ 480 wide, same aspect
    expect(calls.some((c) => c.startsWith('frame'))).toBe(false); // not before `ready`
    readyResolve();
    expect(await p).toBe('data:image/webp;base64,AAAA');
    expect(calls).toContain('frame 7'); // the scene's own stillTime
    expect(calls[calls.length - 1]).toBe('dispose');
  });

  it('caches by scene, size, theme and plate', async () => {
    const { renderStill, clearStills } = await import('./still');
    clearStills();
    const a = renderStill({ scene: 'fake', w: 200, h: 100, dark: false, plate: 'halo' });
    await vi.waitFor(() => expect(calls.some((c) => c.startsWith('resize'))).toBe(true));
    readyResolve();
    await a;
    const n = calls.length;
    expect(renderStill({ scene: 'fake', w: 200, h: 100, dark: false, plate: 'halo' })).toBe(a);
    expect(calls.length).toBe(n);
    expect(renderStill({ scene: 'fake', w: 200, h: 100, dark: true, plate: 'halo' })).not.toBe(a);
  });

  it('gives null for an unknown scene', async () => {
    const { renderStill, clearStills } = await import('./still');
    clearStills();
    expect(await renderStill({ scene: 'nope', w: 100, h: 100, dark: true })).toBeNull();
  });
});
