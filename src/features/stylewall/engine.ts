/**
 * Runs one scene on one canvas: sizes the canvas to what the scene asks for (DPR-aware), follows viewport resizes, ticks on the
 * shared loop with the scene's fps cap, pauses while the tab is hidden, draws a single still frame for reduced motion, eases light↔dark and
 * smooths the pointer. Everything is undone by `dispose()`. Scenes know none of this (types.ts).
 */
import { frameDt, subscribe } from './loop';
import type { Scene, SceneFactory, SceneOptions } from './types';

export type MountArgs = {
  factory: SceneFactory;
  dark: boolean;
  accent: string;
  plate: string;
  /** Reduced motion → one frame at the scene's `stillTime`, then nothing runs. */
  still: boolean;
  seed?: number;
  /** Called once, after the first frame has been drawn (the component fades the canvas in). */
  onFirstFrame?: () => void;
};

export type Mounted = {
  setDark: (dark: boolean) => void;
  setAccent: (accent: string) => void;
  setPlate: (plate: string) => void;
  setStill: (still: boolean) => void;
  dispose: () => void;
};

/** Seconds for the light↔dark crossfade (time constant of the ease, so ~3× this to settle). */
export const DARK_EASE = 0.16;
/** Seconds for the pointer ease. */
export const POINTER_EASE = 0.35;

export const DEFAULT_SEED = 0x5ca1ab1e;

/** Pure: one step of an exponential ease toward `target`; lands exactly on it once within a hair (so the crossfade ends, and stays ended). */
export function easeToward(cur: number, target: number, dt: number, tau: number): number {
  const next = cur + (target - cur) * (1 - Math.exp(-dt / tau));
  return Math.abs(target - next) < 0.002 ? target : next;
}

/** Pure: the key that decides whether the canvas needs re-sizing — resizes that repeat the current size must change nothing. */
export const sizeKey = (vw: number, vh: number, dpr: number): string => `${vw}|${vh}|${dpr}`;

export function mountStyleWallpaper(host: HTMLElement, canvas: HTMLCanvasElement, args: MountArgs): Mounted {
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return { setDark() {}, setAccent() {}, setPlate() {}, setStill() {}, dispose() {} };

  const options: SceneOptions = {
    dark: args.dark ? 1 : 0,
    accent: args.accent,
    plate: args.plate,
    still: args.still,
    px: 0,
    py: 0,
  };
  const scene: Scene = args.factory({ canvas, ctx, options, seed: args.seed ?? DEFAULT_SEED });

  let darkTarget = options.dark;
  let pxTarget = 0;
  let pyTarget = 0;
  let key = '';
  let sized = false;
  let time = 0;
  let last = 0;
  let unsub = () => {};
  let firstDone = false;
  let disposed = false;
  let frozen = false;

  const draw = (dt: number) => {
    scene.frame(time, dt);
    if (!firstDone) {
      firstDone = true;
      args.onFirstFrame?.();
    }
  };

  const drawStill = () => {
    options.dark = darkTarget;
    options.px = 0;
    options.py = 0;
    time = scene.stillTime;
    draw(0);
  };

  /** (Re)size the canvas for the viewport. Returns false — touching nothing — when the size key hasn't changed. */
  const layout = (): boolean => {
    const vw = Math.max(1, host.clientWidth || window.innerWidth);
    const vh = Math.max(1, host.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const k = sizeKey(vw, vh, dpr);
    if (sized && k === key) return false;
    key = k;
    sized = true;
    const size = scene.size(vw, vh, dpr);
    canvas.width = Math.max(1, Math.round(size.w));
    canvas.height = Math.max(1, Math.round(size.h));
    canvas.style.imageRendering = size.smooth ? 'auto' : 'pixelated';
    scene.resize(canvas.width, canvas.height, dpr);
    // a resized canvas is blank: repaint at once so it never flashes empty
    if (options.still) drawStill();
    else if (!document.hidden) draw(0);
    return true;
  };

  const tick = (now: number) => {
    if (disposed || (import.meta.env.DEV && frozen)) return;
    const minGap = 1000 / scene.fps - 1.5;
    if (last && now - last < minGap) return;
    const dt = frameDt(now, last);
    last = now;
    options.dark = easeToward(options.dark, darkTarget, dt, DARK_EASE);
    options.px = easeToward(options.px, pxTarget, dt, POINTER_EASE);
    options.py = easeToward(options.py, pyTarget, dt, POINTER_EASE);
    time += dt;
    draw(dt);
  };

  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    pxTarget = Math.max(-1, Math.min(1, (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1));
    pyTarget = Math.max(-1, Math.min(1, (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1));
  };
  const onLeave = () => {
    pxTarget = 0;
    pyTarget = 0;
  };

  const run = () => {
    if (disposed) return;
    last = 0;
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    unsub = subscribe(tick);
  };
  const halt = () => {
    unsub();
    unsub = () => {};
    window.removeEventListener('pointermove', onPointer);
    document.documentElement.removeEventListener('mouseleave', onLeave);
  };

  layout(); // draws the first frame itself (a still frame when motion is reduced)
  if (!options.still) run();
  // a plate that was still decoding when the still frame was drawn: draw it again with the real thing
  void scene.ready?.then(() => {
    if (!disposed && options.still) drawStill();
  });

  const ro = new ResizeObserver(() => {
    if (disposed) return;
    layout();
  });
  ro.observe(host);

  if (import.meta.env.DEV) {
    // Dev/test-only (compiled out of production builds): step the simulation by hand and freeze the live loop, for steady screenshots.
    Object.defineProperty(canvas, 'swDev', {
      configurable: true,
      value: {
        step: (n: number, dt = 1 / 30) => {
          for (let i = 0; i < n; i++) {
            options.dark = easeToward(options.dark, darkTarget, dt, DARK_EASE);
            options.px = easeToward(options.px, pxTarget, dt, POINTER_EASE);
            options.py = easeToward(options.py, pyTarget, dt, POINTER_EASE);
            time += dt;
            draw(dt);
          }
        },
        freeze: (on = true) => {
          frozen = on;
        },
        at: (t: number) => {
          time = t;
          draw(0);
        },
        pointer: (x: number, y: number) => {
          pxTarget = x;
          pyTarget = y;
          options.px = x;
          options.py = y;
        },
        time: () => time,
      },
    });
  }

  return {
    setDark: (dark) => {
      darkTarget = dark ? 1 : 0;
      if (options.still) drawStill();
    },
    setAccent: (accent) => {
      options.accent = accent;
      if (options.still) drawStill();
    },
    setPlate: (plate) => {
      options.plate = plate;
      if (options.still) drawStill();
    },
    setStill: (still) => {
      if (still === options.still || disposed) return;
      options.still = still;
      if (still) {
        halt();
        pxTarget = pyTarget = 0;
        drawStill();
      } else {
        run();
      }
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      halt();
      ro.disconnect();
      scene.dispose();
      canvas.width = canvas.height = 1;
    },
  };
}
