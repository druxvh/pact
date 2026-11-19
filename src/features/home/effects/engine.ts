/**
 * Runs one effect on one canvas: sizes it to the box (devicePixelRatio-aware), follows resizes, listens for typing and Enter, keeps an
 * "energy" level that effects read to flare or calm, and draws through the shared scheduler — pausing while the tab is hidden or the
 * box is off screen. Everything is undone by `destroy()`.
 *
 * The canvas sits over the box and a margin around it. After an effect has drawn, the inside of the box is erased again, so nothing
 * can ever sit on top of the text (an effect may add a faint `rim` light in a thin band just inside the border).
 */

import { createAurora } from './aurora';
import { createBeam } from './beam';
import { toRgb } from './colors';
import { createElectric } from './electric';
import { createFire } from './fire';
import { type Box, boxTrack, lineTrack, roundRectPath } from './geometry';
import { createHaze } from './haze';
import { createLava } from './lava';
import { createMatrix } from './matrix';
import { createNeon } from './neon';
import { subscribe } from './scheduler';
import { createStardust } from './stardust';
import type { EffectName, Fx, FxEnv, FxFactory, FxInput, Geo } from './types';

export const FACTORIES: Record<EffectName, FxFactory> = {
  beam: createBeam,
  fire: createFire,
  electric: createElectric,
  haze: createHaze,
  neon: createNeon,
  aurora: createAurora,
  stardust: createStardust,
  matrix: createMatrix,
  lava: createLava,
};

/** Height of the strip under the ⌘K field, px at scale 1. */
export const LINE_HEIGHT = 34;

export type Mounted = { destroy: () => void; poke: (kind: 'type' | 'enter') => void };

export type MountOptions = Pick<FxEnv, 'name' | 'scale' | 'dark' | 'still' | 'mode'>;

/**
 * How hard the person is "driving" the effect. Everything is *smoothed*: focus, a keystroke or Enter set a target and the level follows
 * it (quick up, slower down), so no effect ever sees its speed, size or brightness change in a single frame — a step in those is
 * exactly what reads as a glitch in a moving thing.
 */
export type EnergyState = { typed: number; burstRaw: number; energy: number; burst: number };
export const newEnergy = (): EnergyState => ({ typed: 0, burstRaw: 0, energy: 0.22, burst: 0 });

const lag = (cur: number, target: number, dt: number, up: number, down: number): number =>
  cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? up : down)));

/** Pure: advance the energy by `dt` seconds. `energy` is ~0.2 asleep, ~0.5 focused, up to ~1.6 typing hard; `burst` is the short kick after Enter. */
export function stepEnergy(st: EnergyState, dt: number, focus: boolean): { energy: number; burst: number } {
  st.typed *= Math.exp(-dt / 0.9);
  st.burstRaw *= Math.exp(-dt / 0.38);
  const target = (focus ? 0.52 : 0.22) + st.typed * 0.75 + st.burstRaw * 0.7;
  st.energy = lag(st.energy, target, dt, 0.22, 0.5);
  st.burst = lag(st.burst, st.burstRaw, dt, 0.12, 0.12);
  return { energy: st.energy, burst: st.burst };
}

/**
 * The time step for a frame. A hidden or throttled tab can hand us a gap of seconds; simulating it (or even a clamped 100 ms) would make
 * everything hop, so a long gap just resumes at one normal frame, and ordinary slow frames are capped at 100 ms.
 */
export function frameDt(now: number, last: number): number {
  if (!last) return 1 / 60;
  const gap = (now - last) / 1000;
  return gap > 0.25 ? 1 / 60 : Math.min(0.1, Math.max(0, gap));
}

export function mountEffect(host: HTMLElement, canvas: HTMLCanvasElement, opts: MountOptions): Mounted {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { destroy: () => {}, poke: () => {} };
  const brand = getComputedStyle(host).getPropertyValue('--brand').trim();
  const env: FxEnv = { ...opts, accent: toRgb(brand) };
  const fx: Fx = (FACTORIES[opts.name] as FxFactory)(env);
  const s = opts.scale;
  const eventHost = opts.mode === 'line' ? (host.parentElement ?? host) : host;

  let geo: Geo | null = null;
  let visible = true;
  let time = 0;
  let last = 0;
  let key = '';
  let frozen = false;
  const energy = newEnergy();

  /** (Re)size the canvas to the box. Returns false — and touches nothing — when nothing about the box changed, so a ResizeObserver
   *  callback that only repeats the current size can never clear the canvas or reset an effect. */
  const layout = (): boolean => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const m = fx.margin;
    let w: number;
    let h: number;
    let box: Box;
    let track: Geo['track'];
    let css: string;
    if (opts.mode === 'line') {
      w = host.offsetWidth;
      h = LINE_HEIGHT * s;
      box = { x: 0, y: h - 2, w, h: 2, r: 0 };
      track = lineTrack(0, w, h - 1);
      css = `position:absolute;left:0;bottom:0;width:${w}px;height:${h}px;pointer-events:none`;
    } else {
      const bw = host.offsetWidth;
      const bh = host.offsetHeight;
      const r = Number.parseFloat(getComputedStyle(canvas).borderTopLeftRadius) || 0;
      w = bw + 2 * m;
      h = bh + 2 * m;
      box = { x: m, y: m, w: bw, h: bh, r };
      track = boxTrack({ x: m + 0.5, y: m + 0.5, w: bw - 1, h: bh - 1, r: Math.max(0, r - 0.5) });
      css = `position:absolute;left:${-m}px;top:${-m}px;width:${w}px;height:${h}px;pointer-events:none;border-radius:var(--radius-lg)`;
    }
    const next = `${w}|${h}|${box.r}|${dpr}`;
    if (next === key) return false;
    key = next;
    canvas.style.cssText = css;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    geo = { w, h, box, track, dpr };
    fx.setup(geo);
    return true;
  };

  const draw = (dt: number, focus: boolean) => {
    if (!geo) return;
    const e = stepEnergy(energy, dt, focus);
    time += dt; // doubles: even weeks of uptime keep a resolution far below a pixel of motion
    const input: FxInput = { energy: e.energy, focus, burst: e.burst, time };
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, geo.w, geo.h);
    fx.frame(ctx, dt, input);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    if (opts.mode === 'box') {
      // erase the inside of the box (keeping the 1px border), so the effect can never sit over the text
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.beginPath();
      roundRectPath(ctx, geo.box, 1.2);
      ctx.fill();
      ctx.restore();
      if (fx.rim) {
        ctx.save();
        ctx.beginPath();
        roundRectPath(ctx, geo.box, 0);
        roundRectPath(ctx, geo.box, 13 * s);
        ctx.clip('evenodd');
        fx.rim(ctx, input);
        ctx.restore();
      }
    }
  };

  const focused = () => (opts.mode === 'line' ? true : host.matches(':focus-within'));

  const tick = (now: number) => {
    if (!visible || !geo || (import.meta.env.DEV && frozen)) return;
    const minGap = 1000 / fx.fps - 1.5;
    if (last && now - last < minGap) return;
    const dt = frameDt(now, last);
    last = now;
    draw(dt, focused());
  };

  layout();
  if (import.meta.env.DEV) {
    // Dev/test-only (compiled out of production builds): step the simulation by hand and freeze the live loop, for steady screenshots.
    Object.defineProperty(canvas, 'fxDev', {
      configurable: true,
      value: {
        step: (n: number, dt = 1 / 30) => {
          for (let i = 0; i < n; i++) draw(dt, focused());
        },
        freeze: (on = true) => {
          frozen = on;
        },
      },
    });
  }
  let unsub = () => {};
  if (opts.still) {
    // reduced motion: let the effect settle for a moment, draw one frame, and stop
    for (let i = 0; i < 70; i++) draw(1 / 30, false);
  } else {
    unsub = subscribe(tick);
  }

  const ro = new ResizeObserver(() => {
    layout();
    if (opts.still) for (let i = 0; i < 70; i++) draw(1 / 30, false);
  });
  ro.observe(host);
  const io =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entries) => {
          visible = entries.some((e) => e.isIntersecting);
        });
  io?.observe(host);

  const poke = (kind: 'type' | 'enter') => {
    if (opts.still) return;
    if (kind === 'type') energy.typed = Math.min(1.2, energy.typed + 0.42);
    else energy.burstRaw = 1;
    fx.poke(kind);
  };
  const onInput = () => poke('type');
  const onKey = (e: Event) => {
    if ((e as KeyboardEvent).key === 'Enter') poke('enter');
  };
  const onSubmit = () => poke('enter');
  eventHost.addEventListener('input', onInput, true);
  eventHost.addEventListener('keydown', onKey, true);
  eventHost.addEventListener('submit', onSubmit, true);

  return {
    poke,
    destroy: () => {
      unsub();
      ro.disconnect();
      io?.disconnect();
      eventHost.removeEventListener('input', onInput, true);
      eventHost.removeEventListener('keydown', onKey, true);
      eventHost.removeEventListener('submit', onSubmit, true);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
