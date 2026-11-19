/**
 * Aurora: real curtains. Two or three layers of vertical rays stand on the box's top edge (and a short, dim reflection hangs under its
 * bottom edge). Every ray has its own height and brightness, driven by noise that drifts, folds and ripples — a slow, wide field for the
 * curtain's shape and a fast, narrow one for the streaky rays — and each is painted from a green base through teal to violet tips.
 * The border carries a slowly sliding green → teal → violet glow, a few stars shimmer in the sky, and typing makes it brighter and faster;
 * Enter sends a bright ripple across. All phases are integrated (`phase += speed·dt`), so nothing jumps when the speed changes.
 */
import { rgba } from './colors';
import { fbm, noise2, smoothstep, wave } from './noise';
import { mulberry32 } from './rng';
import { surface } from './surface';
import type { Fx, FxEnv, FxInput, Geo, Rgb, Surface } from './types';

type Layer = {
  seed: number;
  drift: number;
  speed: number;
  ray: number;
  scale: number;
  alpha: number;
  phase: number;
  ripple: number;
  strip: HTMLCanvasElement | null;
};

const GREEN_D: Rgb = [70, 255, 150];
const TEAL_D: Rgb = [40, 214, 214];
const VIOLET_D: Rgb = [150, 104, 255];
const GREEN_L: Rgb = [16, 168, 104];
const TEAL_L: Rgb = [14, 150, 190];
const VIOLET_L: Rgb = [108, 66, 224];
const STRIP_H = 96;
const DIV = 5;

export function createAurora(env: FxEnv): Fx {
  const s = env.scale;
  const line = env.mode === 'line';
  const dark = env.dark;
  const [G, T, V] = dark ? [GREEN_D, TEAL_D, VIOLET_D] : [GREEN_L, TEAL_L, VIOLET_L];
  const rng = mulberry32(0xa07a);
  const layers: Layer[] = [
    { seed: 3.1, drift: 0, speed: 0.07, ray: 0.9, scale: 1, alpha: 0.9, phase: 0, ripple: 0, strip: null },
    { seed: 17.4, drift: 0, speed: -0.045, ray: 1.35, scale: 0.78, alpha: 0.62, phase: 0, ripple: 0, strip: null },
    { seed: 41.9, drift: 0, speed: 0.03, ray: 0.62, scale: 1.18, alpha: 0.46, phase: 0, ripple: 0, strip: null },
  ];
  const stars = Array.from({ length: 22 }, () => ({ x: rng(), y: rng(), f: 0.6 + rng() * 2.2, p: rng() * 50, r: 0.5 + rng() * 0.8 }));
  let geo: Geo;
  let lo: Surface | null = null;
  let glow = 0; // sliding border gradient, 0..1 (one full period)
  let pulse = -1; // Enter: a bright ripple travelling left → right (x in px), -1 = none
  let clock = 0;

  const makeStrip = (g: Rgb, t: Rgb, v: Rgb, bias: number): HTMLCanvasElement | null => {
    const sf = surface(env, 1, STRIP_H);
    const x = sf?.ctx;
    if (!sf || !x) return null;
    const gr = x.createLinearGradient(0, STRIP_H, 0, 0); // bottom → top
    gr.addColorStop(0, rgba(g, 0.95));
    gr.addColorStop(0.28 + bias, rgba(g, 0.7));
    gr.addColorStop(0.5 + bias, rgba(t, 0.55));
    gr.addColorStop(0.75, rgba(v, 0.42));
    gr.addColorStop(1, rgba(v, 0));
    x.fillStyle = gr;
    x.fillRect(0, 0, 1, STRIP_H);
    return sf.canvas;
  };

  return {
    margin: 92 * s,
    fps: 24,
    setup(g) {
      geo = g;
      const div = s < 0.7 ? 2 : DIV;
      lo = surface(env, g.w / div, g.h / div);
      lo?.ctx.setTransform(1 / div, 0, 0, 1 / div, 0, 0);
      const strips = [makeStrip(G, T, V, 0), makeStrip(T, V, V, -0.08), makeStrip(G, G, V, 0.1)];
      layers.forEach((l, i) => {
        l.strip = strips[i] ?? null;
      });
    },
    frame(ctx, dt, inp: FxInput) {
      const e = Math.min(1.6, inp.energy);
      clock += dt;
      glow = (glow + dt * (0.035 + 0.03 * e)) % 1;
      for (const l of layers) {
        l.drift += dt * l.speed * (1 + 0.7 * e);
        l.phase += dt * (0.32 + 0.22 * e) * l.ray; // the fast "rays" field
        l.ripple += dt * (0.6 + 0.5 * e);
      }
      if (pulse >= 0) {
        pulse += dt * geo.box.w * 1.15;
        if (pulse > geo.box.w + 140 * s) pulse = -1;
      }
      const { box } = geo;
      const div = s < 0.7 ? 2 : DIV;
      const step = div;
      const x0 = box.x - 20 * s;
      const x1 = box.x + box.w + 20 * s;
      const reach = Math.max(12, Math.min(box.y - 3, (line ? 44 : 82) * s * (0.85 + 0.4 * e)));
      const lift = 1 + 0.35 * e;
      const lctx = lo?.ctx;
      lctx?.clearRect(0, 0, geo.w, geo.h);
      // curtains above the top edge (layers back to front), painted at low resolution and scaled up: that is what makes them soft
      if (lctx && lo) {
        for (const l of layers) {
          if (!l.strip) continue;
          for (let x = x0; x < x1; x += step) {
            const shape = fbm(x * 0.0058 * l.scale + l.drift * 1.6 + l.seed, l.seed * 0.37 + l.ripple * 0.05, 2);
            const body = smoothstep(0.26, 0.76, shape);
            const ray = 0.62 * noise2(x * 0.045 * l.ray + l.seed * 3, l.phase) + 0.38 * noise2(x * 0.19 * l.ray + l.seed, l.phase * 1.4 + 9);
            const h = reach * (0.3 + 0.7 * body) * (0.5 + 0.5 * ray) * l.scale;
            let a = l.alpha * (0.2 + 0.8 * body) * (0.35 + 0.65 * ray) * lift * (dark ? 0.85 : 0.7);
            if (pulse >= 0) a += 0.55 * Math.exp(-(((x - box.x - pulse) / (70 * s)) ** 2));
            if (a < 0.02 || h < 2) continue;
            // the curtain folds: its foot wanders up and down along its length
            const fold = (noise2(x * 0.011 + l.drift * 2, 9.3 + l.seed) - 0.5) * 14 * s;
            lctx.globalAlpha = Math.min(1, a);
            lctx.drawImage(l.strip, 0, 0, 1, STRIP_H, x, box.y + fold - h, step, h);
            if (!line && l === layers[0]) {
              // a short, dim reflection under the bottom edge
              lctx.globalAlpha = Math.min(1, a) * 0.3;
              lctx.drawImage(l.strip, 0, 0, 1, STRIP_H, x, box.y + box.h + h * 0.4, step, -h * 0.4);
            }
          }
        }
        lctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
      if (lo) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(lo.canvas, 0, 0, geo.w, geo.h);
      }
      // a few crisp rays on top give the curtain its streaky grain
      const front = layers[0] as Layer;
      if (front.strip) {
        for (let x = x0; x < x1; x += 4.6 * s) {
          const shape = fbm(x * 0.0058 + front.drift * 1.6 + front.seed, front.seed * 0.37 + front.ripple * 0.05, 2);
          const body = smoothstep(0.34, 0.8, shape);
          const fine = noise2(x * 0.23 + front.seed * 2, front.phase * 1.7 + 3);
          const a = body * smoothstep(0.5, 0.9, fine) * (dark ? 0.55 : 0.4) * lift;
          const h = reach * (0.4 + 0.6 * fine) * (0.3 + 0.7 * body);
          if (a < 0.03 || h < 3) continue;
          ctx.globalAlpha = Math.min(1, a);
          ctx.drawImage(front.strip, 0, 0, 1, STRIP_H, x, box.y - h, Math.max(1, 1.3 * s), h);
        }
      }
      // stars in the sky
      ctx.globalAlpha = 1;
      for (const st of stars) {
        const px = st.x * geo.w;
        const py = st.y * geo.h;
        if (px > box.x - 2 && px < box.x + box.w + 2 && py > box.y - 2 && py < box.y + box.h + 2) continue;
        const tw = wave(clock * st.f, st.p) ** 2.2;
        ctx.fillStyle = dark ? `rgba(220,240,255,${0.12 + 0.6 * tw})` : `rgba(80,110,200,${0.1 + 0.35 * tw})`;
        ctx.beginPath();
        ctx.arc(px, py, st.r * s * (0.7 + 0.5 * tw), 0, Math.PI * 2);
        ctx.fill();
      }
      // the border glows along its length, sliding green → teal → violet
      const w2 = box.w * 2;
      const gx = box.x - box.w * glow;
      const gr = ctx.createLinearGradient(gx, 0, gx + w2, 0);
      const cols = [G, T, V, G, T, V, G];
      for (let i = 0; i < cols.length; i++) gr.addColorStop(i / (cols.length - 1), rgba(cols[i] as Rgb, 0.9));
      ctx.strokeStyle = gr;
      ctx.globalAlpha = (0.42 + 0.14 * wave(clock * 0.8, 4)) * (0.8 + 0.3 * Math.min(1, e));
      ctx.lineWidth = 1.4 * s;
      ctx.beginPath();
      ctx.moveTo(box.x, box.y + 0.5);
      ctx.lineTo(box.x + box.w, box.y + 0.5);
      ctx.moveTo(box.x, box.y + box.h - 0.5);
      ctx.lineTo(box.x + box.w, box.y + box.h - 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    },
    rim(ctx, inp) {
      const { box } = geo;
      const gr = ctx.createLinearGradient(0, box.y, 0, box.y + 14 * s);
      gr.addColorStop(0, rgba(G, 0.16 * (0.7 + 0.4 * Math.min(1, inp.energy))));
      gr.addColorStop(1, rgba(G, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(box.x, box.y, box.w, 14 * s);
    },
    poke(kind) {
      if (kind === 'enter') pulse = 0;
    },
  };
}
