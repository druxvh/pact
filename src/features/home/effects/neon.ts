/**
 * Neon: a glass tube bent round the box — white-hot core, coloured halo, a thin reflection on the glass — in the accent colour. It is
 * never still: electrical flicker, a slow hum, a faint ionised shimmer running along the tube, and now and then the tube stutters off
 * and on like old neon does. The static artwork is painted once; each frame only changes its brightness and the shimmer.
 */
import { lighten, rgba } from './colors';
import { type Box, roundRectPath } from './geometry';
import { wave } from './noise';
import { between, mulberry32 } from './rng';
import { surface } from './surface';
import type { Fx, FxEnv, FxInput, Geo } from './types';

/** off/on timeline of one stutter: [duration ms, brightness]. */
const STUTTERS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [
    [55, 0.05],
    [75, 1],
    [38, 0.08],
    [140, 1],
    [90, 0.35],
  ],
  [
    [120, 0.12],
    [60, 1],
    [45, 0.1],
    [50, 0.9],
    [70, 0.06],
  ],
  [
    [40, 0.2],
    [40, 1],
    [40, 0.15],
    [40, 1],
    [160, 0.5],
  ],
];

export function createNeon(env: FxEnv): Fx {
  const s = env.scale;
  const rng = mulberry32(0x6e30);
  const core = lighten(env.accent, env.dark ? 0.78 : 0.55);
  let geo: Geo;
  let tube: HTMLCanvasElement | null = null;
  let nextStutter = between(rng, 4, 9);
  let stutter: { t: number; line: ReadonlyArray<readonly [number, number]> } | null = null;
  let clock = 0;
  let shimmer = 0;

  const paintTube = () => {
    const sf = surface(env, geo.w * geo.dpr, geo.h * geo.dpr);
    tube = sf?.canvas ?? null;
    const t = sf?.ctx;
    if (!t) return;
    t.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
    const box: Box = geo.box;
    const stroke = (inset: number, width: number, color: string, blur: number, glow: string) => {
      t.save();
      t.shadowColor = glow;
      t.shadowBlur = blur;
      t.strokeStyle = color;
      t.lineWidth = width;
      t.beginPath();
      roundRectPath(t, box, inset);
      t.stroke();
      t.restore();
    };
    // halo (wide, soft) → mid glow → tube body → hot core
    stroke(0.5, 5.5 * s, rgba(env.accent, env.dark ? 0.32 : 0.3), 30 * s, rgba(env.accent, 0.95));
    stroke(0.5, 3.6 * s, rgba(env.accent, env.dark ? 0.62 : 0.7), 13 * s, rgba(env.accent, 0.95));
    stroke(0.5, 2.3 * s, rgba(env.accent, 1), 5 * s, rgba(env.accent, 1));
    stroke(0.5, 1.2 * s, rgba(core, 0.97), 2.5 * s, rgba(core, 0.9));
    // glass reflection: a thin bright line a little inside the top-left of the tube
    t.save();
    t.strokeStyle = 'rgba(255,255,255,0.5)';
    t.lineWidth = 0.7 * s;
    t.lineCap = 'round';
    t.beginPath();
    const r = Math.max(0, box.r - 2.2 * s);
    t.moveTo(box.x + 2.5 * s + box.w * 0.62, box.y + 2.2 * s);
    t.lineTo(box.x + 2.2 * s + r, box.y + 2.2 * s);
    t.arc(box.x + 2.2 * s + r, box.y + 2.2 * s + r, r, -Math.PI / 2, -Math.PI, true);
    t.lineTo(box.x + 2.2 * s, box.y + box.h * 0.55);
    t.stroke();
    t.restore();
  };

  return {
    margin: 36 * s,
    fps: 40,
    setup(g) {
      geo = g;
      paintTube();
    },
    frame(ctx, dt, inp: FxInput) {
      clock += dt;
      if (!stutter && clock >= nextStutter) {
        stutter = { t: 0, line: STUTTERS[Math.floor(rng() * STUTTERS.length)] as (typeof STUTTERS)[number] };
        clock = 0;
        nextStutter = between(rng, 6, 15);
      }
      let level = 1;
      if (stutter) {
        stutter.t += dt * 1000;
        let acc = 0;
        let found = false;
        for (const [ms, v] of stutter.line) {
          acc += ms;
          if (stutter.t < acc) {
            level = v;
            found = true;
            break;
          }
        }
        if (!found) stutter = null;
      }
      const micro = 0.94 + 0.06 * wave(inp.time * 31, 3) * (0.6 + 0.4 * wave(inp.time * 4.3, 8)); // fast electrical flicker
      const hum = 1 - 0.035 * (0.5 + 0.5 * Math.sin(inp.time * 2 * Math.PI * 6.7)); // slow hum
      const lift = 1 + 0.12 * Math.min(1, inp.energy) + 0.25 * inp.burst;
      const a = Math.min(1, level * micro * hum * lift);
      if (!tube) return;
      ctx.globalCompositeOperation = env.dark ? 'lighter' : 'source-over';
      ctx.globalAlpha = a;
      ctx.drawImage(tube, 0, 0, geo.w, geo.h);
      // ionised shimmer: a short bright streak crawling along the tube
      shimmer = (shimmer + dt * (70 + 80 * inp.energy) * s) % geo.track.length;
      ctx.globalAlpha = 1;
      for (const k of [0, 0.5]) {
        const p = geo.track.at(shimmer + geo.track.length * k);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.ty, p.tx));
        ctx.scale(3, 1);
        const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 9 * s);
        gr.addColorStop(0, rgba(core, 0.42 * level));
        gr.addColorStop(0.5, rgba(env.accent, 0.2 * level));
        gr.addColorStop(1, rgba(env.accent, 0));
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(0, 0, 9 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
    rim(ctx, inp) {
      const lvl = 0.12 + 0.05 * Math.min(1, inp.energy);
      ctx.strokeStyle = rgba(env.accent, lvl * (stutter ? 0.2 : 1));
      ctx.lineWidth = 9 * s;
      ctx.beginPath();
      roundRectPath(ctx, geo.box, 3 * s);
      ctx.stroke();
    },
    poke() {},
  };
}
