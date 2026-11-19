/**
 * Fire: a small particle system, not a glow. Flame tongues are born along the box's top edge (and lean off its sides), rise with
 * buoyancy, sway on turbulence and shrink as they cool — white-yellow core → orange → deep red → gone. Embers detach, drift up,
 * wobble and fade. Each flame position has its own irregular flicker (incommensurate sines, never in step), a warm light flickers
 * on the page behind it, and a slow heat shimmer ripples the flames. Typing makes it flare; Enter throws a burst of fire and sparks.
 * On a dark page the light is added (`lighter`); on a light page it is painted over it.
 */
import { rgba } from './colors';
import { wave } from './noise';
import { capped, lifeFraction, type Particle, stepAll } from './particles';
import { between, mulberry32, type Rng } from './rng';
import { surface } from './surface';
import type { Fx, FxEnv, FxInput, Geo } from './types';

/** colour stops by life: [fraction, r, g, b, alpha] */
const RAMP: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0, 255, 240, 190, 0.9],
  [0.1, 255, 200, 70, 0.95],
  [0.32, 255, 128, 22, 0.9],
  [0.58, 222, 52, 14, 0.72],
  [0.82, 140, 22, 10, 0.38],
  [1, 70, 26, 20, 0],
];
const STAGES = 22;
const spriteCache = new Map<boolean, HTMLCanvasElement[]>();

function ramp(u: number): [number, number, number, number] {
  for (let i = 1; i < RAMP.length; i++) {
    const b = RAMP[i] as (typeof RAMP)[number];
    const a = RAMP[i - 1] as (typeof RAMP)[number];
    if (u <= b[0]) {
      const k = (u - a[0]) / (b[0] - a[0] || 1);
      return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k, a[4] + (b[4] - a[4]) * k];
    }
  }
  const e = RAMP[RAMP.length - 1] as (typeof RAMP)[number];
  return [e[1], e[2], e[3], e[4]];
}

function sprites(env: Pick<FxEnv, 'dark' | 'makeSurface'>): HTMLCanvasElement[] {
  const dark = env.dark;
  const hit = env.makeSurface ? undefined : spriteCache.get(dark);
  if (hit) return hit;
  const out: HTMLCanvasElement[] = [];
  for (let i = 0; i < STAGES; i++) {
    const [r, g, b, a] = ramp(i / (STAGES - 1));
    const sf = surface(env, 64, 64);
    const c = sf?.canvas as HTMLCanvasElement;
    const x = sf?.ctx;
    if (x) {
      // on a light page the hot white/yellow would vanish: keep the core warm instead
      const k = dark ? 1 : 0.92;
      const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, `rgba(${r | 0},${(g * k) | 0},${(b * (dark ? 1 : 0.55)) | 0},${a})`);
      gr.addColorStop(0.42, `rgba(${r | 0},${(g * k) | 0},${(b * (dark ? 1 : 0.55)) | 0},${a * 0.55})`);
      gr.addColorStop(1, `rgba(${r | 0},${(g * k) | 0},${(b * (dark ? 1 : 0.55)) | 0},0)`);
      x.fillStyle = gr;
      x.fillRect(0, 0, 64, 64);
    }
    out.push(c);
  }
  if (!env.makeSurface) spriteCache.set(dark, out);
  return out;
}

type Wick = { x: number; y: number; nx: number; ny: number; seed: number; acc: number };

export function createFire(env: FxEnv): Fx {
  const s = env.scale;
  const rng: Rng = mulberry32(0xf1e);
  const flames: Particle[] = [];
  const embers: Particle[] = [];
  const wicks: Wick[] = [];
  let geo: Geo;
  let buf: HTMLCanvasElement | null = null;
  let bctx: CanvasRenderingContext2D | null = null;
  let emberAcc = 0;
  let pendingBurst = 0;
  const line = env.mode === 'line';
  // in the thin strip under the ⌘K field the flames only have ~30px to rise in
  const rise = line ? 0.55 : 1;
  const maxFlames = Math.round(360 * (s < 0.7 ? 0.45 : 1));

  const spawnFlame = (w: Wick, amp: number, boost: number) => {
    const sideways = Math.abs(w.nx) > 0.5;
    flames.push({
      kind: 'flame',
      x: w.x + between(rng, -2.5, 2.5) * s,
      y: w.y + 1,
      vx: (sideways ? w.nx * between(rng, 26, 58) : between(rng, -9, 9)) * s,
      vy: -(54 + 62 * amp) * s * rise * between(rng, 0.78, 1.22) * boost * (sideways ? 0.65 : 1),
      age: 0,
      life: (0.36 + 0.44 * amp + rng() * 0.18) * (sideways ? 0.8 : 1) * (0.9 + 0.1 * boost),
      size: (7 + 8 * amp) * s * (sideways ? 0.75 : 1),
      seed: rng(),
    });
  };

  const spawnEmber = (x: number, y: number, fast = 1) => {
    embers.push({
      kind: 'ember',
      x,
      y,
      vx: between(rng, -22, 22) * s,
      vy: -between(rng, 28, 74) * s * rise * fast,
      age: 0,
      life: between(rng, 1.1, 2.5),
      size: between(rng, 1.1, 2.7) * s,
      seed: rng(),
    });
  };

  const setupWicks = (g: Geo) => {
    wicks.length = 0;
    const { box } = g;
    const gap = 11.5 * s;
    const x0 = box.x + Math.max(box.r * 0.4, 4 * s);
    const x1 = box.x + box.w - Math.max(box.r * 0.4, 4 * s);
    const n = Math.max(2, Math.floor((x1 - x0) / gap));
    for (let i = 0; i <= n; i++) wicks.push({ x: x0 + ((x1 - x0) * i) / n, y: box.y, nx: 0, ny: -1, seed: i * 1.37 + 0.5, acc: 0 });
    if (!line) {
      // flames licking up the sides
      for (const [x, nx] of [
        [box.x, -1],
        [box.x + box.w, 1],
      ] as const) {
        for (let k = 0; k < (s < 0.7 ? 1 : 3); k++)
          wicks.push({ x, y: box.y + box.h * (0.22 + 0.28 * k), nx, ny: 0, seed: 40 + k * 3.1 + (nx > 0 ? 9 : 0), acc: 0 });
      }
    }
  };

  const sheet = () => sprites(env);

  const drawParticle = (c: CanvasRenderingContext2D, p: Particle, boost: number) => {
    const u = lifeFraction(p);
    const stage = Math.min(STAGES - 1, Math.floor(u * (STAGES - 1)));
    const img = sheet()[stage] as HTMLCanvasElement;
    if (p.kind === 'ember') {
      const flick = 0.45 + 0.55 * Math.abs(Math.sin(p.age * 27 + p.seed * 40) * Math.sin(p.age * 11.3 + p.seed * 7));
      c.globalAlpha = Math.min(1, (1 - u) * 1.5) * flick * (env.dark ? 1 : 1.2);
      const sz = p.size * (1 - 0.5 * u) * 3.4;
      c.drawImage(sheet()[Math.min(STAGES - 1, Math.floor(2 + u * 9))] as HTMLCanvasElement, p.x - sz, p.y - sz, sz * 2, sz * 2);
      return;
    }
    const fadeIn = Math.min(1, u / 0.1 + 0.15);
    c.globalAlpha = Math.min(1, fadeIn * (1 - u) ** 0.6 * (env.dark ? 0.52 : 0.95) * boost);
    const sz = p.size * (1 - 0.78 * u ** 1.3);
    c.drawImage(img, p.x - sz, p.y - sz * 1.35, sz * 2, sz * 2.7);
  };

  return {
    margin: (line ? 6 : 78) * s,
    fps: 45,
    setup(g) {
      geo = g;
      setupWicks(g);
      const sf = surface(env, g.w * g.dpr, g.h * g.dpr);
      buf = sf?.canvas ?? null;
      bctx = sf?.ctx ?? null;
    },
    frame(ctx, dt, inp: FxInput) {
      if (!bctx || !buf) return;
      const F = 0.62 + 0.55 * inp.energy;
      const t = inp.time;
      // —— emit ——
      for (let i = 0; i < wicks.length; i++) {
        const w = wicks[i] as Wick;
        const side = Math.abs(w.nx) > 0.5;
        const amp = wave(t * (side ? 1.3 : 0.9) + w.seed * 3.7, w.seed) ** 1.5;
        w.acc += (7 + 30 * amp) * F * dt * (side ? 0.45 : 1) * (s < 0.7 ? 0.8 : 1);
        while (w.acc >= 1) {
          w.acc -= 1;
          spawnFlame(w, amp, 0.92 + 0.22 * inp.energy);
        }
      }
      // a few embers break away, more when it's excited
      emberAcc += (1.6 + 7 * inp.energy) * dt * (s < 0.7 ? 0.7 : 1) * (line ? 0.5 : 1);
      while (emberAcc >= 1) {
        emberAcc -= 1;
        const w = wicks[Math.floor(rng() * wicks.length)] as Wick;
        spawnEmber(w.x, w.y - 3 * s);
      }
      if (pendingBurst > 0) {
        const n = Math.min(pendingBurst, 14);
        pendingBurst -= n;
        for (let k = 0; k < n; k++) {
          const w = wicks[Math.floor(rng() * wicks.length)] as Wick;
          spawnFlame(w, 0.8 + 0.2 * rng(), 1.45);
          if (k % 4 === 0) spawnEmber(w.x, w.y - 4 * s, 1.8);
        }
      }
      capped(flames, maxFlames);
      capped(embers, 48);
      stepAll(flames, dt, t, s, 0.6 + 0.6 * inp.energy);
      stepAll(embers, dt, t, s, 1);

      // —— the warm light it throws on the page (flickers with the fire) ——
      const flick = 0.55 + 0.45 * wave(t * 11, 2) * (0.7 + 0.3 * wave(t * 3.1, 5));
      const { box } = geo;
      ctx.globalCompositeOperation = env.dark ? 'lighter' : 'source-over';
      const cx = box.x + box.w / 2;
      const cy = box.y + (line ? 0 : box.h * 0.3);
      const rx = box.w * 0.62 + 36 * s;
      const ry = (line ? 22 : 62) * s + 22 * inp.energy * s;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      const spill = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      const a = (env.dark ? 0.2 : 0.17) * flick * (0.65 + 0.5 * inp.energy);
      spill.addColorStop(0, rgba([255, 128, 36], a));
      spill.addColorStop(0.55, rgba([230, 70, 18], a * 0.4));
      spill.addColorStop(1, rgba([200, 30, 10], 0));
      ctx.fillStyle = spill;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // —— flames and embers into the side buffer ——
      bctx.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
      bctx.globalCompositeOperation = 'source-over';
      bctx.globalAlpha = 1;
      bctx.clearRect(0, 0, geo.w, geo.h);
      bctx.globalCompositeOperation = env.dark ? 'lighter' : 'source-over';
      const boost = 0.92 + 0.2 * inp.energy;
      for (const p of flames) drawParticle(bctx, p, boost);
      for (const p of embers) drawParticle(bctx, p, 1);
      bctx.globalAlpha = 1;

      // heat shimmer: the buffer is laid down in thin strips, each nudged sideways by a travelling ripple
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const strip = Math.max(2, 3 * s);
      const amp = (0.55 + 0.7 * inp.energy) * s;
      for (let y = 0; y < geo.h; y += strip) {
        const dx = Math.sin(y * 0.33 + t * 8.7) * amp + Math.sin(y * 0.11 - t * 3.3) * amp * 0.6;
        ctx.drawImage(buf, 0, y * geo.dpr, buf.width, strip * geo.dpr, dx, y, geo.w, strip);
      }
      // the border glows where the fire stands on it
      ctx.globalCompositeOperation = env.dark ? 'lighter' : 'source-over';
      ctx.strokeStyle = rgba([255, 150, 50], (env.dark ? 0.3 : 0.4) * flick);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(box.x + box.r, box.y + 0.5);
      ctx.lineTo(box.x + box.w - box.r, box.y + 0.5);
      ctx.stroke();
    },
    rim(ctx, inp) {
      const { box } = geo;
      const flick = 0.55 + 0.45 * wave(inp.time * 11, 2);
      const gr = ctx.createLinearGradient(0, box.y, 0, box.y + 14 * s);
      gr.addColorStop(0, rgba([255, 130, 40], 0.2 * flick * (0.7 + 0.4 * inp.energy)));
      gr.addColorStop(1, rgba([255, 100, 20], 0));
      ctx.fillStyle = gr;
      ctx.fillRect(box.x, box.y, box.w, 14 * s);
    },
    poke(kind) {
      pendingBurst += kind === 'enter' ? 88 : 5;
    },
  };
}
