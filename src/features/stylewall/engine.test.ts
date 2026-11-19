import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DARK_EASE, easeToward, mountStyleWallpaper, sizeKey } from './engine';
import { activeCount, frameDt } from './loop';
import { fakeContext, must } from './testUtil';
import type { Scene, SceneFactory, SceneOptions } from './types';

/** A manual requestAnimationFrame: `tick(ms)` advances the clock and runs what was queued. */
function installRaf() {
  let now = 1000;
  let nextId = 1;
  const queue = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queue.delete(id);
  });
  return {
    pending: () => queue.size,
    tick(ms = 1000 / 60) {
      now += ms;
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb(now);
    },
    run(frames: number, ms = 1000 / 60) {
      for (let i = 0; i < frames; i++) this.tick(ms);
    },
  };
}

type Log = {
  frames: Array<{ t: number; dt: number; dark: number; px: number }>;
  resizes: Array<[number, number, number]>;
  sizes: number;
  disposed: number;
  options: SceneOptions;
};

function makeFactory(opts: { fps?: number; stillTime?: number; wide?: boolean } = {}): { factory: SceneFactory; log: Log } {
  const log: Log = { frames: [], resizes: [], sizes: 0, disposed: 0, options: undefined as unknown as SceneOptions };
  const factory: SceneFactory = ({ options }) => {
    log.options = options;
    const scene: Scene = {
      fps: opts.fps ?? 30,
      stillTime: opts.stillTime ?? 9,
      size: (vw, vh, dpr) => {
        log.sizes++;
        return { w: Math.round(vw * dpr * (opts.wide ? 2 : 1)), h: Math.round(vh * dpr), smooth: false };
      },
      resize: (w, h, dpr) => {
        log.resizes.push([w, h, dpr]);
      },
      frame: (t, dt) => {
        log.frames.push({ t, dt, dark: options.dark, px: options.px });
      },
      dispose: () => {
        log.disposed++;
      },
    };
    return scene;
  };
  return { factory, log };
}

function makeHost(w = 800, h = 600) {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(host, 'clientHeight', { value: h, configurable: true });
  const canvas = document.createElement('canvas');
  host.append(canvas);
  document.body.append(host);
  return { host, canvas };
}

let raf: ReturnType<typeof installRaf>;
const mounts: Array<{ dispose: () => void }> = [];
/** Mount and remember, so a test that fails half way cannot leave a subscriber on the shared loop for the next one. */
const mount = (...args: Parameters<typeof mountStyleWallpaper>) => {
  const m = mountStyleWallpaper(...args);
  mounts.push(m);
  return m;
};
let resizeCallbacks: Array<() => void> = [];

beforeEach(() => {
  raf = installRaf();
  resizeCallbacks = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        resizeCallbacks.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => fakeContext()) as never);
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
});

afterEach(() => {
  for (const m of mounts.splice(0)) m.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  document.body.replaceChildren();
});

const base = { dark: true, accent: '#3a3aff', plate: 'halo', still: false };

describe('pure helpers', () => {
  it('easeToward converges and lands exactly on the target (so a crossfade ends, and stays ended)', () => {
    let v = 0;
    for (let i = 0; i < 200 && v !== 1; i++) v = easeToward(v, 1, 1 / 30, DARK_EASE);
    expect(v).toBe(1);
    expect(easeToward(1, 1, 1 / 30, DARK_EASE)).toBe(1);
    // monotone: never overshoots
    let w = 0;
    for (let i = 0; i < 50; i++) {
      const n = easeToward(w, 1, 1 / 30, DARK_EASE);
      expect(n).toBeGreaterThanOrEqual(w);
      expect(n).toBeLessThanOrEqual(1);
      w = n;
    }
  });

  it('frameDt: a normal gap passes, a long gap (hidden tab) resumes at one frame, never a jump', () => {
    expect(frameDt(1033, 1000)).toBeCloseTo(0.033, 3);
    expect(frameDt(1000 + 5000, 1000)).toBeCloseTo(1 / 30, 6);
    expect(frameDt(1000 + 200, 1000)).toBeCloseTo(0.1, 6); // capped
    expect(frameDt(1000, 0)).toBeCloseTo(1 / 30, 6);
  });

  it('sizeKey changes with any of its inputs', () => {
    expect(sizeKey(1, 2, 3)).not.toBe(sizeKey(1, 2, 2));
    expect(sizeKey(1, 2, 3)).toBe(sizeKey(1, 2, 3));
  });
});

describe('mountStyleWallpaper', () => {
  it('sizes the canvas to what the scene asks for, tells the scene, and draws a first frame at once', () => {
    const { host, canvas } = makeHost(800, 600);
    const { factory, log } = makeFactory();
    let first = 0;
    const m = mount(host, canvas, { factory, ...base, onFirstFrame: () => first++ });
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(canvas.style.imageRendering).toBe('pixelated');
    expect(log.resizes).toEqual([[1600, 1200, 2]]);
    expect(log.frames).toHaveLength(1);
    expect(first).toBe(1);
    m.dispose();
  });

  it('runs on the shared loop at the scene fps cap, and time only moves forward', () => {
    const { host, canvas } = makeHost();
    const { factory, log } = makeFactory({ fps: 30 });
    const m = mount(host, canvas, { factory, ...base });
    log.frames.length = 0;
    raf.run(120, 1000 / 60); // two seconds of 60 Hz display
    // 30 fps cap → about 60 frames in 2 s, never 120
    expect(log.frames.length).toBeGreaterThan(50);
    expect(log.frames.length).toBeLessThanOrEqual(62);
    for (let i = 1; i < log.frames.length; i++) expect(must(log.frames[i]).t).toBeGreaterThan(must(log.frames[i - 1]).t);
    expect(must(log.frames[log.frames.length - 1]).t).toBeCloseTo(2, 0);
    m.dispose();
  });

  it('does nothing while the tab is hidden, and resumes without a jump', () => {
    const { host, canvas } = makeHost();
    const { factory, log } = makeFactory();
    const m = mount(host, canvas, { factory, ...base });
    raf.run(30);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    const before = log.frames.length;
    raf.run(60);
    expect(log.frames.length).toBe(before);
    expect(raf.pending()).toBe(0); // the loop stopped; nothing is scheduled
    const tBefore = must(log.frames[log.frames.length - 1]).t;
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    raf.run(3, 5000); // the first tick after 5 s away
    const tAfter = must(log.frames[log.frames.length - 1]).t;
    expect(tAfter - tBefore).toBeLessThan(0.3); // a frame, not five seconds of simulation
    m.dispose();
  });

  it('with reduced motion draws exactly one frame at the scene stillTime and schedules nothing', () => {
    const { host, canvas } = makeHost();
    const { factory, log } = makeFactory({ stillTime: 9 });
    const m = mount(host, canvas, { factory, ...base, still: true });
    expect(log.frames).toHaveLength(1);
    expect(must(log.frames[0]).t).toBe(9);
    expect(activeCount()).toBe(0);
    expect(raf.pending()).toBe(0);
    raf.run(100);
    expect(log.frames).toHaveLength(1);
    m.dispose();
  });

  it('a still wallpaper redraws (once) when the theme or accent changes, and again on a resize', () => {
    const { host, canvas } = makeHost();
    const { factory, log } = makeFactory();
    const m = mount(host, canvas, { factory, ...base, still: true });
    m.setDark(false);
    expect(log.frames).toHaveLength(2);
    expect(must(log.frames[1]).dark).toBe(0); // switched at once: there is no animation to ease in a still
    m.setAccent('#ff0000');
    expect(log.options.accent).toBe('#ff0000');
    expect(log.frames).toHaveLength(3);
    Object.defineProperty(host, 'clientWidth', { value: 1000, configurable: true });
    for (const cb of resizeCallbacks) cb();
    expect(log.frames).toHaveLength(4);
    expect(activeCount()).toBe(0);
    m.dispose();
  });

  it('switching reduced motion on stops the loop; switching it off starts it again', () => {
    const { host, canvas } = makeHost();
    const { factory, log } = makeFactory();
    const m = mount(host, canvas, { factory, ...base });
    raf.run(10);
    expect(activeCount()).toBe(1);
    m.setStill(true);
    expect(activeCount()).toBe(0);
    const n = log.frames.length;
    raf.run(60);
    expect(log.frames.length).toBe(n);
    m.setStill(false);
    expect(activeCount()).toBe(1);
    raf.run(10);
    expect(log.frames.length).toBeGreaterThan(n);
    m.dispose();
  });

  it('eases light → dark over a few frames and lands exactly on 1, never overshooting', () => {
    const { host, canvas } = makeHost();
    const { factory, log } = makeFactory();
    const m = mount(host, canvas, { factory, ...base, dark: false });
    raf.run(5);
    m.setDark(true);
    log.frames.length = 0;
    raf.run(90);
    const darks = log.frames.map((f) => f.dark);
    expect(must(darks[0])).toBeLessThan(0.5);
    expect(darks.some((d) => d > 0 && d < 1)).toBe(true);
    for (let i = 1; i < darks.length; i++) {
      expect(must(darks[i])).toBeGreaterThanOrEqual(must(darks[i - 1]));
      expect(must(darks[i])).toBeLessThanOrEqual(1);
      expect(must(darks[i]) - must(darks[i - 1])).toBeLessThan(0.45); // no frame jumps the whole transition
    }
    expect(must(darks[darks.length - 1])).toBe(1);
    m.dispose();
  });

  it('follows the pointer smoothly (−1…1), ignores touch, and lets go on leave', () => {
    const { host, canvas } = makeHost();
    const { factory, log } = makeFactory();
    const m = mount(host, canvas, { factory, ...base });
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    const move = (x: number, y: number, type = 'mouse') => {
      const e = new Event('pointermove') as Event & { clientX: number; clientY: number; pointerType: string };
      Object.assign(e, { clientX: x, clientY: y, pointerType: type });
      window.dispatchEvent(e);
    };
    move(1000, 400, 'touch');
    raf.run(30);
    expect(log.options.px).toBe(0);
    move(1000, 400);
    log.frames.length = 0;
    raf.run(150);
    const px = log.frames.map((f) => f.px);
    expect(must(px[px.length - 1])).toBeCloseTo(1, 1);
    for (let i = 1; i < px.length; i++) expect(Math.abs(must(px[i]) - must(px[i - 1]))).toBeLessThan(0.2);
    document.documentElement.dispatchEvent(new Event('mouseleave'));
    raf.run(120);
    expect(Math.abs(log.options.px)).toBeLessThan(0.01);
    m.dispose();
  });

  it('a resize that repeats the current size changes nothing; a real one re-sizes and redraws', () => {
    const { host, canvas } = makeHost(800, 600);
    const { factory, log } = makeFactory();
    const m = mount(host, canvas, { factory, ...base });
    const sizes = log.sizes;
    for (const cb of resizeCallbacks) cb();
    expect(log.sizes).toBe(sizes);
    expect(log.resizes).toHaveLength(1);
    Object.defineProperty(host, 'clientWidth', { value: 640, configurable: true });
    for (const cb of resizeCallbacks) cb();
    expect(log.resizes).toHaveLength(2);
    expect(canvas.width).toBe(1280);
    m.dispose();
  });

  it('dispose() stops everything: no subscribers, no frames, scene disposed once, listeners gone', () => {
    const { host, canvas } = makeHost();
    const { factory, log } = makeFactory();
    const m = mount(host, canvas, { factory, ...base });
    raf.run(10);
    m.dispose();
    m.dispose();
    expect(log.disposed).toBe(1);
    expect(activeCount()).toBe(0);
    const n = log.frames.length;
    raf.run(60);
    expect(log.frames.length).toBe(n);
    window.dispatchEvent(new Event('pointermove'));
    for (const cb of resizeCallbacks) cb();
    expect(log.frames.length).toBe(n);
    expect(canvas.width).toBe(1);
  });

  it('returns an inert handle when there is no 2D context', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => null) as never);
    const { host, canvas } = makeHost();
    const { factory, log } = makeFactory();
    const m = mount(host, canvas, { factory, ...base });
    expect(log.frames).toHaveLength(0);
    expect(() => {
      m.setDark(false);
      m.setStill(true);
      m.dispose();
    }).not.toThrow();
  });

  it('long simulated run: a day of 30 fps ticks keeps time monotonic, steps bounded, and leaks nothing', () => {
    const { host, canvas } = makeHost();
    const { factory, log } = makeFactory();
    const m = mount(host, canvas, { factory, ...base });
    log.frames.length = 0;
    // 20 minutes of display ticks at 60 Hz, with a hidden-tab gap and a long stall in the middle
    for (let i = 0; i < 20 * 60 * 60; i++) {
      if (i === 30000) Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      if (i === 30600) {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }
      raf.tick(i === 30700 ? 8000 : 1000 / 60);
      if (log.frames.length > 5000) log.frames.splice(0, 2500);
    }
    let maxStep = 0;
    for (let i = 1; i < log.frames.length; i++) {
      const step = must(log.frames[i]).t - must(log.frames[i - 1]).t;
      expect(step).toBeGreaterThan(0);
      maxStep = Math.max(maxStep, step);
    }
    expect(maxStep).toBeLessThanOrEqual(0.101);
    expect(raf.pending()).toBe(1); // exactly one rAF in flight, ever
    m.dispose();
    expect(activeCount()).toBe(0);
  });
});
