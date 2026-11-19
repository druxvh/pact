/**
 * A canvas that draws nothing and remembers: every effect can be run headlessly through it, frame by frame, and its "ink" — how much light a
 * frame puts down (stroke length × width × alpha, fill area × alpha, bitmap area × the source's own ink) — compared between frames. That is what
 * the continuity tests use to prove nothing pops, jumps or restarts. Not shipped: only tests import it.
 */
import { FACTORIES, newEnergy, stepEnergy } from '@/features/home/effects/engine';
import { boxTrack } from '@/features/home/effects/geometry';
import type { EffectName, Fx, FxEnv, FxInput, Geo, Surface } from '@/features/home/effects/types';

/** `Path2D` exists in browsers; happy-dom doesn't ship it, so give the effects a recording stand-in. */
class PathRecorder {
  pts: Array<[number, number]> = [];
  moveTo(x: number, y: number) {
    this.pts.push([x, y]);
  }
  lineTo(x: number, y: number) {
    this.pts.push([x, y]);
  }
}
if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') (globalThis as { Path2D?: unknown }).Path2D = PathRecorder;

const alphaOf = (css: unknown): number => {
  if (typeof css === 'object' && css !== null && 'meanAlpha' in css) return (css as { meanAlpha: number }).meanAlpha;
  if (typeof css !== 'string') return 0.6;
  const m = /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(css);
  return m ? Number(m[1]) : 1;
};

class Gradient {
  stops: number[] = [];
  addColorStop(_o: number, c: string) {
    this.stops.push(alphaOf(c));
  }
  get meanAlpha() {
    return this.stops.length ? this.stops.reduce((a, b) => a + b, 0) / this.stops.length : 0.5;
  }
}

export type Heads = Array<{ x: number; y: number; r: number }>;

export class Rec {
  // state the effects set
  strokeStyle: unknown = '#000';
  fillStyle: unknown = '#000';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  imageSmoothingEnabled = true;
  imageSmoothingQuality = 'low';
  font = '';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  shadowColor = '';
  shadowBlur = 0;
  /** light put down since the last full clear */
  ink = 0;
  /** every filled circle this frame (the beam's heads are the biggest dots) */
  arcs: Heads = [];
  private path: Array<[number, number]> = [];
  private pathArea = 0;
  readonly canvas: { width: number; height: number; rec: Rec };

  constructor(
    public w: number,
    public h: number,
  ) {
    this.canvas = { width: w, height: h, rec: this };
  }

  beginFrame() {
    this.ink = 0;
    this.arcs = [];
  }
  beginPath() {
    this.path = [];
    this.pathArea = 0;
  }
  closePath() {}
  moveTo(x: number, y: number) {
    this.path.push([x, y]);
  }
  lineTo(x: number, y: number) {
    this.path.push([x, y]);
  }
  arc(x: number, y: number, r: number) {
    this.path.push([x, y]);
    this.pathArea += Math.PI * r * r;
    this.arcs.push({ x, y, r });
  }
  rect(_x: number, _y: number, w: number, h: number) {
    this.pathArea += w * h;
  }
  private length(pts: Array<[number, number]>) {
    let l = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as [number, number];
      const b = pts[i] as [number, number];
      l += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return l;
  }
  stroke(p?: PathRecorder) {
    const pts = p ? p.pts : this.path;
    this.ink += this.length(pts) * this.lineWidth * this.globalAlpha * alphaOf(this.strokeStyle);
  }
  fill() {
    this.ink += this.pathArea * this.globalAlpha * alphaOf(this.fillStyle);
  }
  fillRect(_x: number, _y: number, w: number, h: number) {
    this.ink += Math.min(w * h, this.w * this.h) * this.globalAlpha * alphaOf(this.fillStyle);
  }
  clearRect(x: number, y: number, w: number, h: number) {
    if (x <= 0 && y <= 0 && w >= this.w && h >= this.h) this.ink = 0;
  }
  fillText() {
    this.ink += 20 * this.globalAlpha;
  }
  drawImage(src: { rec?: Rec; width?: number; height?: number }, ...a: number[]) {
    const dw = a.length >= 8 ? (a[6] as number) : a.length >= 4 ? (a[2] as number) : (src.width ?? 1);
    const dh = a.length >= 8 ? (a[7] as number) : a.length >= 4 ? (a[3] as number) : (src.height ?? 1);
    const sw = a.length >= 8 ? (a[2] as number) : (src.width ?? 1);
    const sh = a.length >= 8 ? (a[3] as number) : (src.height ?? 1);
    const area = Math.abs(dw * dh);
    if (src.rec) {
      // the source's own ink, scaled by how much of it is drawn and how large
      const frac = (Math.abs(sw * sh) || 1) / ((src.width ?? 1) * (src.height ?? 1) || 1);
      const scale = area / (Math.abs(sw * sh) || 1);
      this.ink += src.rec.ink * frac * Math.min(scale, 40) * this.globalAlpha;
    } else {
      this.ink += area * 0.3 * this.globalAlpha;
    }
  }
  createLinearGradient() {
    return new Gradient();
  }
  createRadialGradient() {
    return new Gradient();
  }
  createPattern() {
    return {};
  }
  createImageData(w: number, h: number) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  putImageData(img: { width: number; height: number; data: Uint8ClampedArray }) {
    let a = 0;
    for (let i = 3; i < img.data.length; i += 4) a += img.data[i] as number;
    this.ink = (a / 255) * 6; // a low-res bitmap is later scaled up: weight it
  }
  getImageData(_x: number, _y: number, w: number, h: number) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  scale() {}
  setTransform() {}
  clip() {}
}

/** The factory effects use for off-screen canvases: each is a recorder of its own. */
export const makeSurface = (w: number, h: number): Surface => {
  const r = new Rec(w, h);
  return { canvas: r.canvas as unknown as HTMLCanvasElement, ctx: r as unknown as CanvasRenderingContext2D };
};

/** What the person does, as a script over simulated seconds. */
export type Script = { focus?: (t: number) => boolean; type?: number[]; enter?: number[] };

export type Run = {
  fx: Fx;
  geo: Geo;
  main: Rec;
  /** advance one frame; returns the ink drawn */
  step: (dt: number) => number;
  time: () => number;
};

/** Seeded `Math.random` for the effects that use it for per-frame jitter (grain, lightning brightness). */
export function seedRandom(seed: number): () => void {
  const orig = Math.random;
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    Math.random = orig;
  };
}

const BOX = { w: 300, h: 56, r: 10 };

/** Run an effect headlessly. `start` is the simulated clock at frame 0 (to test that a huge clock is as good as a small one). */
export function runEffect(
  name: EffectName,
  opts: { dark?: boolean; scale?: number; mode?: 'box' | 'line'; script?: Script; start?: number; box?: { w: number; h: number; r: number } } = {},
): Run {
  const scale = opts.scale ?? 1;
  const mode = opts.mode ?? 'box';
  const env: FxEnv = { name, scale, dark: opts.dark ?? true, still: false, mode, accent: [255, 122, 24], makeSurface };
  const fx = FACTORIES[name](env);
  const b = opts.box ?? BOX;
  const m = fx.margin;
  const w = mode === 'line' ? b.w : b.w + 2 * m;
  const h = mode === 'line' ? 34 * scale : b.h + 2 * m;
  const box = mode === 'line' ? { x: 0, y: h - 2, w, h: 2, r: 0 } : { x: m, y: m, w: b.w, h: b.h, r: b.r };
  const track =
    mode === 'line'
      ? { length: w, closed: false, at: (d: number, off = 0) => ({ x: Math.min(w, Math.max(0, d)), y: h - 1 - off, nx: 0, ny: -1, tx: 1, ty: 0 }) }
      : boxTrack({ x: m + 0.5, y: m + 0.5, w: b.w - 1, h: b.h - 1, r: Math.max(0, b.r - 0.5) });
  const geo: Geo = { w, h, box, track, dpr: 1 };
  fx.setup(geo);
  const main = new Rec(w, h);
  let time = opts.start ?? 0;
  let sim = 0;
  const script = opts.script ?? {};
  const typed = [...(script.type ?? [])];
  const enters = [...(script.enter ?? [])];
  // the same smoothing the engine applies (kept in sync by importing it)
  const state = newEnergy();
  const step = (dt: number): number => {
    sim += dt;
    time += dt;
    while (typed.length && (typed[0] as number) <= sim) {
      typed.shift();
      state.typed = Math.min(1.2, state.typed + 0.42);
      fx.poke('type');
    }
    while (enters.length && (enters[0] as number) <= sim) {
      enters.shift();
      state.burstRaw = 1;
      fx.poke('enter');
    }
    const e = stepEnergy(state, dt, script.focus ? script.focus(sim) : false);
    const input: FxInput = { energy: e.energy, focus: script.focus ? script.focus(sim) : false, burst: e.burst, time };
    main.beginFrame();
    fx.frame(main as unknown as CanvasRenderingContext2D, dt, input);
    return main.ink;
  };
  return { fx, geo, main, step, time: () => time };
}
