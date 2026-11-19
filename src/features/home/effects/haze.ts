/**
 * Haze: a pink haze with a physical feel, drawn at low resolution and scaled up (which is what makes it soft rather than a CSS gradient).
 * Six large blobs in different pinks, magenta, peach and lilac wander on independent slow Lissajous paths; a domain-warped fractal-noise
 * mist drifts through them; a little film grain is laid over the haze (only where there is haze) and jittered every frame. It
 * breathes, and swirls faster while you type. On a dark page light is added; on a light page it is painted over it.
 */
import { rgba } from './colors';
import { roundRectPath } from './geometry';
import { fbm, noise2, smoothstep, wave } from './noise';
import { between, mulberry32 } from './rng';
import { surface } from './surface';
import type { Fx, FxEnv, FxInput, Geo } from './types';

type Blob = {
  c: readonly [number, number, number];
  ax: number;
  ay: number;
  fx: number;
  fy: number;
  px: number;
  py: number;
  r: number;
  a: number;
  breath: number;
};

const COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [255, 92, 172],
  [226, 58, 208],
  [255, 172, 134],
  [178, 138, 255],
  [255, 120, 154],
  [255, 64, 138],
];

export function createHaze(env: FxEnv): Fx {
  const s = env.scale;
  const rng = mulberry32(0x4a2e);
  const div = s < 0.7 ? 3 : 5;
  let geo: Geo;
  let lo: HTMLCanvasElement;
  let lctx: CanvasRenderingContext2D | null = null;
  let mist: HTMLCanvasElement;
  let mctx: CanvasRenderingContext2D | null = null;
  let image: ImageData | null = null;
  let grain: CanvasPattern | null = null;
  /** alpha 1 in the middle, easing to 0 at the canvas edge, so the haze never ends in a visible line */
  let edge: HTMLCanvasElement | null = null;
  let clock = 0;
  const blobs: Blob[] = COLORS.map((c, i) => ({
    c,
    ax: between(rng, 0.55, 1.05),
    ay: between(rng, 0.7, 1.3),
    // slow and incommensurate: 0.07–0.23 rad/s, no two alike
    fx: 0.071 + i * 0.037 + rng() * 0.02,
    fy: 0.053 + i * 0.043 + rng() * 0.02,
    px: rng() * 6.28,
    py: rng() * 6.28,
    r: between(rng, 0.7, 1.15),
    a: between(rng, 0.42, 0.62),
    breath: rng() * 20,
  }));

  const makeGrain = (): CanvasPattern | null => {
    const sf = surface(env, 128, 128);
    const g = sf?.canvas;
    const x = sf?.ctx;
    if (!g || !x) return null;
    const img = x.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random();
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v > 0.5 ? 255 : 30;
      img.data[i + 3] = Math.abs(v - 0.5) * 2 * 120;
    }
    x.putImageData(img, 0, 0);
    return x.createPattern(g, 'repeat');
  };

  return {
    margin: 64 * s,
    fps: 26,
    setup(g) {
      geo = g;
      const lw = Math.max(2, Math.ceil(g.w / div));
      const lh = Math.max(2, Math.ceil(g.h / div));
      const lsf = surface(env, lw, lh);
      lo = lsf?.canvas as HTMLCanvasElement;
      lctx = lsf?.ctx ?? null;
      const msf = surface(env, lw, lh);
      mist = msf?.canvas as HTMLCanvasElement;
      mctx = msf?.ctx ?? null;
      image = mctx ? mctx.createImageData(lo.width, lo.height) : null;
      grain ??= makeGrain();
      const esf = surface(env, lw, lh);
      edge = esf?.canvas ?? null;
      const ex = esf?.ctx;
      if (ex) {
        const id = ex.createImageData(lo.width, lo.height);
        const fade = (dist: number, room: number) => smoothstep(0, room, dist);
        const room = Math.max(3, (g.box.x * 0.78) / div);
        for (let y = 0; y < lo.height; y++) {
          for (let x = 0; x < lo.width; x++) {
            const a = Math.min(fade(x, room), fade(lo.width - 1 - x, room), fade(y, room), fade(lo.height - 1 - y, room));
            id.data[(y * lo.width + x) * 4 + 3] = a * 255;
          }
        }
        ex.putImageData(id, 0, 0);
      }
    },
    frame(ctx, dt, inp: FxInput) {
      if (!lctx || !mctx || !image) return;
      clock += dt * (0.8 + 0.9 * inp.energy + 1.6 * inp.burst);
      const t = clock;
      const { box } = geo;
      const add = env.dark;
      const W = lo.width;
      const H = lo.height;

      // blobs
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.globalCompositeOperation = 'source-over';
      lctx.clearRect(0, 0, W, H);
      lctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      for (const b of blobs) {
        const x = cx + Math.sin(t * b.fx + b.px) * b.ax * (box.w / 2 + 26 * s) + Math.sin(t * b.fx * 2.3 + b.py) * 20 * s;
        const y = cy + Math.sin(t * b.fy + b.py) * b.ay * (box.h / 2 + 30 * s);
        const r = (box.h * 1.25 + 46 * s) * b.r * (1 + 0.1 * Math.sin(t * 0.37 + b.breath));
        const breathe = 0.78 + 0.22 * wave(t * 0.5 + b.breath, b.breath);
        const a = b.a * breathe * (add ? 0.8 : 0.92) * (0.9 + 0.25 * Math.min(1, inp.energy));
        const gr = lctx.createRadialGradient(x / div, y / div, 0, x / div, y / div, r / div);
        gr.addColorStop(0, rgba(b.c, a));
        gr.addColorStop(0.5, rgba(b.c, a * 0.42));
        gr.addColorStop(1, rgba(b.c, 0));
        lctx.fillStyle = gr;
        lctx.fillRect(0, 0, W, H);
      }

      // mist: warped fractal noise, tinted pink→peach, strongest near the box and fading with distance
      const d = image.data;
      const bx0 = box.x / div;
      const by0 = box.y / div;
      const bx1 = (box.x + box.w) / div;
      const by1 = (box.y + box.h) / div;
      const reach = (46 * s) / div;
      const amount = add ? 0.5 : 0.62;
      for (let y = 0; y < H; y++) {
        const dy = y < by0 ? by0 - y : y > by1 ? y - by1 : 0;
        for (let x = 0; x < W; x++) {
          const dx = x < bx0 ? bx0 - x : x > bx1 ? x - bx1 : 0;
          const dist = Math.hypot(dx, dy);
          const near = Math.exp(-((dist / reach) ** 2) * 0.9);
          const nx = x * 0.085 + t * 0.045;
          const ny = y * 0.085 - t * 0.03;
          const w = fbm(nx + 3.1, ny + 1.7 + t * 0.02, 2);
          const n = fbm(nx + w * 1.7, ny + w * 1.3, 3);
          const m = smoothstep(0.36, 0.8, n) * near;
          const tint = noise2(x * 0.05 + t * 0.03, y * 0.05 + 4.2);
          const i = (y * W + x) * 4;
          d[i] = 255;
          d[i + 1] = 104 + tint * 70;
          d[i + 2] = 176 - tint * 40;
          d[i + 3] = m * amount * 255;
        }
      }
      mctx.putImageData(image, 0, 0);
      lctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
      lctx.drawImage(mist, 0, 0);

      if (edge) {
        lctx.globalCompositeOperation = 'destination-in';
        lctx.drawImage(edge, 0, 0);
      }

      // up to full size (smoothed)
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(lo, 0, 0, geo.w, geo.h);

      // film grain, only where there is haze, jittering every frame
      if (grain) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = add ? 0.3 : 0.2;
        ctx.fillStyle = grain;
        ctx.translate(Math.floor(Math.random() * 128), Math.floor(Math.random() * 128));
        ctx.fillRect(-128, -128, geo.w + 256, geo.h + 256);
        ctx.restore();
      }
    },
    rim(ctx, inp) {
      const breath = 0.5 + 0.5 * Math.sin(clock * 0.9);
      ctx.strokeStyle = rgba([255, 96, 176], (0.14 + 0.1 * breath) * (0.8 + 0.3 * Math.min(1, inp.energy)));
      ctx.lineWidth = 9 * s;
      ctx.beginPath();
      roundRectPath(ctx, geo.box, 2 * s);
      ctx.stroke();
    },
    poke() {},
  };
}
