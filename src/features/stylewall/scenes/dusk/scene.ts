/**
 * Scene "Dithered Dusk": a hand-placed-looking pixel-art sunset — an ordered-dither sky in a seven-step palette, a big low sun (and a
 * crescent moon after dark), five layers of procedural ridgeline with mist between them, a tiered pine silhouette along the nearest
 * hill, and a little weather: drifting dithered clouds, twinkling stars, a rare shooting star, a few birds. Dark is dusk, light is dawn.
 *
 * Technique. Everything static is *baked* once per theme variant into small canvases at the scene's own pixel grid (≈ 480×300 at 1440×900):
 * the sky and sun are one ImageData quantised through a Bayer 8×8 matrix against the palette, each ridge is a column profile filled with a
 * dithered mist gradient, each cloud layer is a horizontally tileable strip. A frame is then a handful of `drawImage` calls at whole-pixel
 * offsets (so motion steps like pixel art) plus ~100 `fillRect`s for stars and birds. The canvas is scaled up by CSS with
 * `image-rendering: pixelated`.
 *
 * Motion (always alive, never distracting): cloud layers drift at 1–3 px per second, stars twinkle between three levels, birds cross the
 * glow, a shooting star every ~50 s, the sun creeps a pixel at a time (the sky is re-baked on each step), the pointer slides ridges and clouds a
 * few pixels in proportion to their depth. The light↔dark crossfade renders the dark scene into a buffer and blends it over the light one.
 */
import { hexToRgb, mixRgb, rgbToHex } from '../../colors';
import { bayerThresholds } from '../../dither';
import { fbm2, tileFbm } from '../../noise';
import { bakeCanvas, makeCanvas, packHex, releaseCanvas } from '../../pixels';
import { clamp, mulberry32 } from '../../rng';
import type { SceneFactory, SceneSize } from '../../types';
import { DUSK_DARK, DUSK_LIGHT, type DuskPalette } from './palette';
import { inPine, RIDGE_MARGIN, RIDGES, ridgeProfile, treeLine } from './ridges';

const BAYER8 = bayerThresholds(8);

/** Pixel-art cell size in CSS pixels for a viewport: 3 px at 1440 wide, 4 at 1920, never below 2 (so a phone still gets ~200 columns). */
export const duskCell = (vw: number): number => Math.max(2, Math.round(Math.max(vw, 360) / 480));

export function duskSize(vw: number, vh: number): SceneSize {
  const cell = duskCell(vw);
  return { w: Math.max(8, Math.ceil(vw / cell)), h: Math.max(8, Math.ceil(vh / cell)), smooth: false };
}

export type DuskLayout = {
  sun: { x: number; y: number; r: number };
  moon: { x: number; y: number; r: number };
};

/** Where the sun and moon sit for a canvas: landscape puts the sun right of centre, a portrait phone centres it. */
export function duskLayout(w: number, h: number): DuskLayout {
  const portrait = w < h * 0.85;
  const r = Math.max(10, Math.min(h * 0.125, w * (portrait ? 0.19 : 0.2)));
  return {
    sun: { x: w * (portrait ? 0.55 : 0.73), y: h * 0.585, r },
    moon: { x: w * (portrait ? 0.2 : 0.17), y: h * 0.17, r: Math.max(4, h * 0.04) },
  };
}

type Variant = {
  sky: HTMLCanvasElement;
  /** The sun disc on its own, so it can creep by whole pixels without ever re-baking the sky. */
  sun: HTMLCanvasElement;
  ridges: HTMLCanvasElement[];
  clouds: HTMLCanvasElement[];
  dark: boolean;
  pal: DuskPalette;
};

const CLOUD_LAYERS = [
  { y: 0.24, band: 0.12, speed: 0.9, parallax: 1.4, period: 4, thr: 0.4 },
  { y: 0.36, band: 0.13, speed: 1.7, parallax: 2.6, period: 5, thr: 0.4 },
  { y: 0.47, band: 0.11, speed: 2.8, parallax: 3.8, period: 6, thr: 0.39 },
] as const;

const BIRDS = 4;
const STARS = 110;

export const create: SceneFactory = ({ ctx, options, seed }) => {
  let W = 0;
  let H = 0;
  let layout: DuskLayout = duskLayout(8, 8);
  let light: Variant | null = null;
  let dark: Variant | null = null;
  let buffer: HTMLCanvasElement | null = null;
  let bufCtx: CanvasRenderingContext2D | null = null;
  let stars = new Float32Array(0); // x, y, phase, rate, size
  let starCount = 0;
  let birds = new Float32Array(0); // x0, y0, speed, phase
  let disposed = false;
  let drift = { x: 0, y: 0 };
  /** The sky's low-frequency wobble (palette-independent, so both themes share it): computed once per size. */
  let warp = new Float32Array(0);
  let idleHandle: number | null = null;

  // ───────────────────────── baking ─────────────────────────

  const bakeSky = (pal: DuskPalette, isDark: boolean): HTMLCanvasElement => {
    const sky = pal.sky.map((h) => packHex(h));
    const n = sky.length;
    const { sun, moon } = layout;
    const moonC = pal.moon.map((h) => packHex(h));
    const horizonY = H * 0.8;
    return bakeCanvas(W, H, (words) => {
      for (let y = 0; y < H; y++) {
        const u = clamp(y / horizonY, 0, 1);
        const t = u ** 1.65;
        for (let x = 0; x < W; x++) {
          // the glow is baked at the sun's reference position; the disc itself drifts on top (see bakeSun)
          const d = Math.hypot(x + 0.5 - sun.x, (y + 0.5 - sun.y) * 1.18) / sun.r;
          let v = t * (n - 1.8) + (warp[y * W + x] as number) * (0.4 + 0.6 * t) + 3.1 * Math.exp(-((d / 3.2) ** 2));
          if (isDark) {
            const md = Math.hypot(x + 0.5 - moon.x, y + 0.5 - moon.y) / moon.r;
            v += 0.9 * Math.exp(-((md / 3.4) ** 2));
          }
          v = clamp(v, 0, n - 1);
          const base = Math.floor(v);
          const f = clamp((v - base - 0.5) * 1.7 + 0.5, 0, 1);
          const th = BAYER8[(y & 7) * 8 + (x & 7)] as number;
          let idx = f > th ? base + 1 : base;
          if (idx > n - 1) idx = n - 1;
          let px = sky[idx] as number;
          if (isDark) {
            // a crescent moon: the lit disc minus a shifted disc, its dark limb in a dimmer tone
            const mdx = x + 0.5 - moon.x;
            const mdy = y + 0.5 - moon.y;
            if (Math.hypot(mdx, mdy) < moon.r) {
              const cut = Math.hypot(mdx - moon.r * 0.5, mdy + moon.r * 0.18) < moon.r * 0.92;
              if (!cut) px = moonC[0] as number;
              else if (Math.hypot(mdx, mdy) > moon.r - 1.1) px = moonC[1] as number;
            }
          }
          words[y * W + x] = px;
        }
      }
    });
  };

  /** The sun: a disc in three tones shaded from the upper left (dithered between neighbours), a clean rim; transparent around it. */
  const bakeSun = (pal: DuskPalette): HTMLCanvasElement => {
    const r = layout.sun.r;
    const size = Math.ceil(r * 2) + 2;
    const sunC = pal.sun.map((h) => packHex(h));
    return bakeCanvas(size, size, (words) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x + 0.5 - size / 2;
          const dy = y + 0.5 - size / 2;
          const d = Math.hypot(dx, dy) / r;
          if (d >= 1) continue;
          const th = BAYER8[(y & 7) * 8 + (x & 7)] as number;
          const s = clamp(0.62 + d * 0.5 + (dy / r) * 0.38 + (dx / r) * 0.16, 0, 1.999);
          const sb = Math.floor(s);
          const sf = clamp((s - sb - 0.5) * 1.6 + 0.5, 0, 1);
          words[y * size + x] = d > 0.93 ? (sunC[2] as number) : (sunC[sf > th ? Math.min(2, sb + 1) : sb] as number);
        }
      }
    });
  };

  const bakeRidges = (pal: DuskPalette, isDark: boolean): HTMLCanvasElement[] => {
    const cols = W + 2 * RIDGE_MARGIN;
    const haze = hexToRgb(pal.haze);
    const rim = packHex(pal.rim);
    const sunX = layout.sun.x;
    return RIDGES.map((spec, i) => {
      const profile = ridgeProfile(spec, i, W, H, seed);
      const bodyRgb = hexToRgb(pal.ridges[i] as string);
      const body = packHex(pal.ridges[i] as string);
      const hazeAmt = [0.5, 0.38, 0.26, 0.14, 0][i] as number;
      const fog = packHex(rgbToHex(mixRgb(bodyRgb, haze, hazeAmt)));
      const deep = packHex(rgbToHex(mixRgb(bodyRgb, [0, 0, 0], isDark ? 0.18 : 0.1)));
      const fogLen = Math.max(12, H * (0.2 - i * 0.02));
      const trees = i === RIDGES.length - 1 ? treeLine(profile, seed ^ 0xc0ffee, 0.16) : [];
      return bakeCanvas(cols, H, (words) => {
        for (let x = 0; x < cols; x++) {
          const top = profile[x] as number;
          const toSun = x - RIDGE_MARGIN < sunX ? 4 : -4;
          const lit = (profile[clamp(x + toSun, 0, cols - 1)] as number) - top >= 2;
          for (let y = top; y < H; y++) {
            const depth = y - top;
            const th = BAYER8[(y & 7) * 8 + (x & 7)] as number;
            const g = clamp(depth / fogLen, 0, 1);
            // mist pools in the valleys: the ridge colour thins toward a lighter mix, dithered; the far valleys sink to a darker base
            let px = g * 0.9 > th ? (i === 0 ? fog : fog) : body;
            if (hazeAmt === 0) px = depth > H * 0.1 && depth * 0.04 > th * 2 ? deep : body;
            if (depth === 0 && lit && i >= 1 && i <= 3) px = rim;
            words[y * cols + x] = px;
          }
        }
        for (const [tx, ty, th] of trees) {
          const cx = tx + RIDGE_MARGIN;
          for (let y = Math.max(0, ty); y < ty + th && y < H; y++) {
            for (let x = cx - 6; x <= cx + 6; x++) if (x >= 0 && x < cols && inPine(x, y, cx, ty, th)) words[y * cols + x] = body;
          }
        }
      });
    });
  };

  const bakeClouds = (pal: DuskPalette, isDark: boolean): HTMLCanvasElement[] =>
    CLOUD_LAYERS.map((layer, j) => {
      const bandH = Math.max(12, Math.round(H * layer.band * 2));
      const [litHex, bodyHex, shadeHex] = pal.cloud;
      // the higher layers are farther from the glow: their lit edge is a softer mix of the warm tone with the body
      const litC = packHex(rgbToHex(mixRgb(hexToRgb(litHex), hexToRgb(bodyHex), [0.5, 0.25, 0][j] as number)));
      const bodyC = packHex(bodyHex);
      const shadeC = packHex(shadeHex);
      const s = (seed + j * 4099) | 0;
      // density field (tileable along x), then a hard silhouette: clean pixel-art shapes, dither only *inside* for the tones
      const dens = new Float32Array(W * bandH);
      for (let y = 0; y < bandH; y++) {
        const prof = Math.exp(-((((y + 0.5) / bandH - 0.5) / 0.28) ** 2));
        for (let x = 0; x < W; x++) {
          const n = tileFbm((x / W) * layer.period, (y / bandH) * 2.6 + j * 3.3, layer.period, 4, s);
          dens[y * W + x] = n * prof;
        }
      }
      const at = (x: number, y: number) => (y < 0 || y >= bandH ? 0 : (dens[y * W + (((x % W) + W) % W)] as number));
      return bakeCanvas(W, bandH, (words) => {
        for (let y = 0; y < bandH; y++) {
          for (let x = 0; x < W; x++) {
            const d = at(x, y);
            if (d < layer.thr) continue;
            const th = BAYER8[(y & 7) * 8 + (x & 7)] as number;
            // light comes from the low sun: the near-horizon side of a puff is warm, the far side cool (dusk) / the top is bright (dawn)
            const warmEdge = at(x, y + (isDark ? 2 : -2)) < layer.thr;
            const coolEdge = at(x, y + (isDark ? -3 : 3)) < layer.thr;
            const inner = clamp((d - layer.thr) / 0.12, 0, 1);
            let px = bodyC;
            if (warmEdge) px = litC;
            else if (coolEdge) px = inner > th ? bodyC : shadeC;
            else if (inner < 0.55 && th > inner + 0.25) px = shadeC;
            words[y * W + x] = px;
          }
        }
      });
    });

  const buildVariant = (isDark: boolean): Variant => {
    const pal = isDark ? DUSK_DARK : DUSK_LIGHT;
    return {
      sky: bakeSky(pal, isDark),
      sun: bakeSun(pal),
      ridges: bakeRidges(pal, isDark),
      clouds: bakeClouds(pal, isDark),
      dark: isDark,
      pal,
    };
  };

  const releaseVariant = (v: Variant | null) => {
    if (!v) return;
    releaseCanvas(v.sky);
    releaseCanvas(v.sun);
    for (const c of v.ridges) releaseCanvas(c);
    for (const c of v.clouds) releaseCanvas(c);
  };

  const bakeWarp = () => {
    const warpSeed = (seed ^ 0x51ed) | 0;
    warp = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) warp[y * W + x] = (fbm2((x / W) * 2.3, (y / H) * 3.2, 3, warpSeed) - 0.5) * 0.55;
  };

  /** After the first frame, bake the *other* theme while the browser is idle, so flipping light/dark later costs no hitch. */
  const prebakeOther = () => {
    if (idleHandle !== null) return;
    const run = () => {
      idleHandle = null;
      if (disposed || W === 0) return;
      const wantDark = options.dark < 0.5;
      if (wantDark ? !dark : !light) ensure(wantDark);
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    idleHandle = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 2000 }) : window.setTimeout(run, 300);
  };

  const populate = () => {
    const rng = mulberry32(seed ^ 0xdada);
    stars = new Float32Array(STARS * 5);
    let k = 0;
    // a cap on attempts: on a tiny canvas the clear sky can be smaller than the exclusion zones, and the loop must still end
    for (let attempts = 0; k < STARS && attempts < STARS * 40; attempts++) {
      const x = rng() * W;
      const y = H * 0.52 * rng() ** 1.5;
      const dsx = x - layout.sun.x;
      const dsy = y - layout.sun.y;
      if (Math.hypot(dsx, dsy) < layout.sun.r * 3.4) continue;
      if (Math.hypot(x - layout.moon.x, y - layout.moon.y) < layout.moon.r * 2.2) continue;
      const big = rng() < 0.07;
      stars.set([Math.floor(x), Math.floor(y), rng() * 6.283, 0.35 + rng() * 1.1, big ? 2 : 1], k * 5);
      k++;
    }
    starCount = k;
    birds = new Float32Array(BIRDS * 4);
    for (let b = 0; b < BIRDS; b++) birds.set([rng() * (W + 40), H * (0.3 + rng() * 0.2), 4 + rng() * 4, rng() * 6.283], b * 4);
  };

  // ───────────────────────── painting ─────────────────────────

  const paint = (target: CanvasRenderingContext2D, v: Variant, t: number, px: number, py: number) => {
    target.imageSmoothingEnabled = false;
    target.globalAlpha = 1;
    target.drawImage(v.sky, 0, 0);
    target.drawImage(v.sun, Math.round(layout.sun.x + drift.x - v.sun.width / 2), Math.round(layout.sun.y + drift.y - v.sun.height / 2));

    // stars (dusk only): three twinkle levels, none while the sky is light
    if (v.dark) {
      const star = v.pal.star;
      const bright = v.pal.starBright;
      const dim = rgbToHex(mixRgb(hexToRgb(star), hexToRgb(v.pal.sky[1] as string), 0.55));
      for (let i = 0; i < starCount; i++) {
        const o = i * 5;
        const sx = (stars[o] as number) + Math.round(px * -0.6);
        const sy = stars[o + 1] as number;
        const lvl = Math.sin(t * (stars[o + 3] as number) + (stars[o + 2] as number));
        const size = stars[o + 4] as number;
        target.fillStyle = lvl > 0.45 ? bright : lvl > -0.35 ? star : dim;
        target.fillRect(sx, sy, 1, 1);
        if (size > 1 && lvl > -0.35) {
          target.fillRect(sx - 1, sy, 1, 1);
          target.fillRect(sx + 1, sy, 1, 1);
          target.fillRect(sx, sy - 1, 1, 1);
          target.fillRect(sx, sy + 1, 1, 1);
        }
      }
      // a shooting star every ~50 s
      const k = Math.floor(t / 50);
      const h1 = mulberry32((k * 2654435761) ^ seed)();
      const start = k * 50 + 10 + h1 * 25;
      const age = t - start;
      if (age >= 0 && age < 1.1) {
        const x0 = W * (0.12 + 0.6 * mulberry32(k ^ seed ^ 7)());
        const y0 = H * (0.05 + 0.18 * mulberry32(k ^ seed ^ 13)());
        const hx = x0 + age * 90;
        const hy = y0 + age * 40;
        for (let i = 0; i < 10; i++) {
          target.fillStyle = i < 2 ? bright : i < 5 ? star : dim;
          target.fillRect(Math.round(hx - i * 0.91), Math.round(hy - i * 0.41), 1, 1);
        }
      }
    }

    // clouds: whole-pixel scroll, a layer-specific parallax
    for (let j = 0; j < CLOUD_LAYERS.length; j++) {
      const layer = CLOUD_LAYERS[j] as (typeof CLOUD_LAYERS)[number];
      const c = v.clouds[j] as HTMLCanvasElement;
      const shift = Math.floor(t * layer.speed) + Math.round(px * layer.parallax);
      const x0 = -(((shift % W) + W) % W);
      const y = Math.round(H * layer.y - c.height / 2 + py * layer.parallax * 0.5);
      target.drawImage(c, x0, y);
      target.drawImage(c, x0 + W, y);
    }

    // birds
    target.fillStyle = v.pal.bird;
    for (let b = 0; b < BIRDS; b++) {
      const o = b * 4;
      const span = W + 40;
      const x = Math.floor((((birds[o] as number) + t * (birds[o + 2] as number)) % span) - 20);
      const y = Math.round((birds[o + 1] as number) + 3 * Math.sin(t * 0.6 + (birds[o + 3] as number)));
      const flap = Math.floor(t * 2.4 + (birds[o + 3] as number)) & 1;
      target.fillRect(x + 2, y + 2, 1, 1);
      if (flap) {
        target.fillRect(x, y, 1, 1);
        target.fillRect(x + 4, y, 1, 1);
        target.fillRect(x + 1, y + 1, 1, 1);
        target.fillRect(x + 3, y + 1, 1, 1);
      } else {
        target.fillRect(x, y + 1, 2, 1);
        target.fillRect(x + 3, y + 1, 2, 1);
      }
    }

    // ridges, far → near
    for (let i = 0; i < RIDGES.length; i++) {
      const spec = RIDGES[i] as (typeof RIDGES)[number];
      const dx = Math.round(-px * spec.parallax) - RIDGE_MARGIN;
      const dy = Math.round(-py * spec.parallax * 0.25);
      target.drawImage(v.ridges[i] as HTMLCanvasElement, dx, dy);
    }
  };

  const ensure = (isDark: boolean): Variant => {
    if (isDark) {
      if (!dark) dark = buildVariant(true);
      return dark;
    }
    if (!light) light = buildVariant(false);
    return light;
  };

  /** The sun creeps a pixel at a time on a slow loop (the disc is a sprite, so nothing is ever re-baked). */
  const driftAt = (t: number) => ({ x: Math.round(6 * Math.sin(t / 95)), y: Math.round(4 * Math.sin(t / 140 + 1.3)) });

  return {
    fps: 30,
    stillTime: 14,
    size: (vw, vh) => duskSize(vw, vh),
    resize(w, h) {
      W = w;
      H = h;
      layout = duskLayout(w, h);
      releaseVariant(light);
      releaseVariant(dark);
      light = dark = null;
      releaseCanvas(buffer);
      buffer = bufCtx = null;
      drift = driftAt(0);
      bakeWarp();
      populate();
    },
    frame(t) {
      if (disposed || W === 0) return;
      if (!options.still) prebakeOther();
      if (!options.still) drift = driftAt(t);
      const m = options.dark;
      const px = options.px;
      const py = options.py;
      if (m <= 0.001) paint(ctx, ensure(false), t, px, py);
      else if (m >= 0.999) paint(ctx, ensure(true), t, px, py);
      else {
        paint(ctx, ensure(false), t, px, py);
        if (!buffer) {
          buffer = makeCanvas(W, H);
          bufCtx = buffer.getContext('2d', { alpha: false });
        }
        if (bufCtx) {
          paint(bufCtx, ensure(true), t, px, py);
          ctx.globalAlpha = m;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(buffer, 0, 0);
          ctx.globalAlpha = 1;
        }
      }
    },
    dispose() {
      disposed = true;
      if (idleHandle !== null) {
        const w = window as Window & { cancelIdleCallback?: (h: number) => void };
        if (w.cancelIdleCallback) w.cancelIdleCallback(idleHandle);
        else window.clearTimeout(idleHandle);
        idleHandle = null;
      }
      releaseVariant(light);
      releaseVariant(dark);
      releaseCanvas(buffer);
      light = dark = buffer = null;
      bufCtx = null;
    },
  };
};
