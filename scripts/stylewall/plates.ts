/**
 * Dev-only: builds the engraving plates the Ultramarine wallpaper ("Engraved Halo") draws at its heart.
 *
 *   bun scripts/stylewall/plates.ts [--preview <dir>] [--only marcus|dore|durer] [--marcus <png>] [--dore <jpg>] [--durer <jpg>]
 *
 * A *plate* is a small indexed PNG (2 bits per pixel) with four classes — see PLATE_CLASSES and PALETTE — which the scene recolours at run time:
 * in dark, `lit` is lavender ink on an ultramarine ground; in light, `shade` is navy ink on lavender paper. One file serves both themes.
 *
 * Marcus (`halo`): the repo already holds a 176×208 ordered-dither mask of the Metropolitan Museum's bust (public domain). This script
 * *reconstructs* its tone (a matte-aware Gaussian over the 1-bit cells), upscales it ×3 with a Catmull-Rom filter, and re-renders it as a
 * blue-noise stipple (no visible grid, unlike Bayer) with a drawn silhouette contour. The photograph itself is not needed and not in the repo.
 *
 * Doré (`rose`) and Dürer (`melencolia`) are processed from the Wikimedia Commons scans (both public domain; the JPEGs are NOT in the repo —
 * pass them with --dore / --durer: "File:Paradiso Canto 31 (no caption).jpg" 2448×2992, "File:Dürer Melancholia I.jpg" 3146×4000). They are
 * circular crops, so they fill the roundel; each function below says how its picture is read and re-cut.
 *
 * Fully deterministic: no randomness besides seeded generators, no timestamps; the PNG filter/zlib choice is the smallest of several.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import jpeg from 'jpeg-js';
import { blueNoise } from '../../src/features/stylewall/dither.ts';
import { decodePng, encodeIndexed, encodeRgba } from './png.ts';

/** Pixel classes in a plate PNG. */
export const PLATE_CLASSES = { empty: 0, lit: 1, shade: 2, edge: 3 } as const;

const OUT_DIR = resolve(import.meta.dir, '../../src/features/stylewall/plates');
const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const previewDir = arg('--preview');
const only = arg('--only');
const marcusPath = resolve(arg('--marcus') ?? resolve(import.meta.dir, '../../src/features/ultramarine/assets/marcus-bust.png'));
const darg = arg('--dore');
const uarg = arg('--durer');
const darePath = darg ? resolve(darg) : null;
const durerPath = uarg ? resolve(uarg) : null;

// ───────────────────────── image maths ─────────────────────────

type Field = { w: number; h: number; v: Float32Array };

/** Gaussian blur (separable, clamped edges) of `src` weighted by `weight` (matte-aware: the outside contributes nothing). */
function blurWeighted(src: Float32Array, weight: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.ceil(sigma * 3);
  const k = new Float32Array(2 * r + 1);
  for (let i = -r; i <= r; i++) k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  const num = new Float32Array(w * h);
  const den = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    num[i] = (src[i] as number) * (weight[i] as number);
    den[i] = weight[i] as number;
  }
  const pass = (a: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let i = -r; i <= r; i++) {
          const xx = horizontal ? Math.min(w - 1, Math.max(0, x + i)) : x;
          const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + i));
          s += (a[yy * w + xx] as number) * (k[i + r] as number);
        }
        out[y * w + x] = s;
      }
    return out;
  };
  const n2 = pass(pass(num, true), false);
  const d2 = pass(pass(den, true), false);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (d2[i] as number) > 1e-4 ? (n2[i] as number) / (d2[i] as number) : 0;
  return out;
}

const cr = (t: number, p0: number, p1: number, p2: number, p3: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

/** Catmull-Rom upscale by an integer factor. */
function upscale(f: Field, K: number): Field {
  const w = f.w * K;
  const h = f.h * K;
  const at = (x: number, y: number) => f.v[Math.min(f.h - 1, Math.max(0, y)) * f.w + Math.min(f.w - 1, Math.max(0, x))] as number;
  const tmp = new Float32Array(w * f.h);
  for (let y = 0; y < f.h; y++)
    for (let X = 0; X < w; X++) {
      const sx = (X + 0.5) / K - 0.5;
      const x0 = Math.floor(sx);
      const t = sx - x0;
      tmp[y * w + X] = cr(t, at(x0 - 1, y), at(x0, y), at(x0 + 1, y), at(x0 + 2, y));
    }
  const out = new Float32Array(w * h);
  const at2 = (x: number, y: number) => tmp[Math.min(f.h - 1, Math.max(0, y)) * w + x] as number;
  for (let Y = 0; Y < h; Y++) {
    const sy = (Y + 0.5) / K - 0.5;
    const y0 = Math.floor(sy);
    const t = sy - y0;
    for (let x = 0; x < w; x++) out[Y * w + x] = cr(t, at2(x, y0 - 1), at2(x, y0), at2(x, y0 + 1), at2(x, y0 + 2));
  }
  return { w, h, v: out };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ───────────────────────── Marcus ─────────────────────────

/**
 * Every plate is a *positive* picture in both themes: `lit` pixels are lavender on the ultramarine ground in dark, `shade` pixels are navy ink on
 * the paper in light, `edge` is a bright contour, `empty` shows the ground.
 */
type Plate = { w: number; h: number; classes: Uint8Array };

function marcusPlate(): Plate {
  const src = decodePng(new Uint8Array(readFileSync(marcusPath)));
  const { w: sw, h: sh } = src;
  const idx = src.indices as Uint8Array;
  const tone = new Float32Array(sw * sh);
  const matte = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    matte[i] = idx[i] === 0 ? 0 : 1;
    tone[i] = idx[i] === 2 ? 1 : 0;
  }
  // 1. recover the tone the dither was standing in for (inside the figure only)
  const soft = blurWeighted(tone, matte, sw, sh, 1.05);
  // 2. local contrast: push each pixel away from a wide local mean (a CLAHE-ish lift so folds and features read)
  const wide = blurWeighted(soft, matte, sw, sh, 9);
  const adj = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) adj[i] = clamp01((soft[i] as number) + ((soft[i] as number) - (wide[i] as number)) * 0.95);
  // 3. auto-levels inside the matte
  const vals: number[] = [];
  for (let i = 0; i < sw * sh; i++) if (matte[i]) vals.push(adj[i] as number);
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.03)] as number;
  const hi = vals[Math.floor(vals.length * 0.985)] as number;
  for (let i = 0; i < sw * sh; i++) {
    const t = clamp01(((adj[i] as number) - lo) / (hi - lo));
    adj[i] = t * 0.4 + (t * t * (3 - 2 * t)) * 0.6; // a gentle S-curve: deeper shadows, cleaner lights
  }

  const K = 3;
  const T = upscale({ w: sw, h: sh, v: adj }, K);
  // a soft matte (blur the binary one a little first so the silhouette is smooth, then threshold after the upscale)
  const softMatte = blurWeighted(matte, new Float32Array(sw * sh).fill(1), sw, sh, 0.8);
  const M = upscale({ w: sw, h: sh, v: softMatte }, K);

  const pad = 6;
  const w = T.w + pad * 2;
  const h = T.h + pad * 2;
  const classes = new Uint8Array(w * h);
  const inside = new Uint8Array(w * h);
  for (let y = 0; y < T.h; y++) for (let x = 0; x < T.w; x++) if ((M.v[y * T.w + x] as number) > 0.5) inside[(y + pad) * w + x + pad] = 1;

  // 4. stipple: thresholds from a tileable blue-noise tile. Lit dots where tone is high, shade dots where it is low (never both).
  const N = 64;
  const bn = blueNoise(N, 20251119);
  const S = 0.7; // max coverage of either ink
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside[y * w + x]) continue;
      const t = T.v[(y - pad) * T.w + (x - pad)] as number;
      const n = bn[(y % N) * N + (x % N)] as number;
      const tl = clamp01(t);
      if (n < tl * S) classes[y * w + x] = PLATE_CLASSES.lit;
      else if (n > 1 - (1 - tl) * S) classes[y * w + x] = PLATE_CLASSES.shade;
    }
  // 5. the contour: a 1 px line on the silhouette, drawn over the stipple — except along the flat base where the bust was cut off by the
  //    source frame (that edge was never a contour; the roundel's own rim hides it)
  let lastRow = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside[y * w + x]) lastRow = y;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      if (!inside[y * w + x]) continue;
      const left = !inside[y * w + x - 1];
      const right = !inside[y * w + x + 1];
      const up = !inside[(y - 1) * w + x];
      const down = !inside[(y + 1) * w + x];
      const baseOnly = down && !left && !right && !up && y >= lastRow - 1;
      if ((left || right || up || down) && !baseOnly && !(down && y >= lastRow - 1)) classes[y * w + x] = PLATE_CLASSES.edge;
    }
  return { w, h, classes };
}


// ───────────────────────── JPEG sources: Doré and Dürer ─────────────────────────

type Gray = { w: number; h: number; g: Float32Array };

/** Decode a JPEG to luma 0…1. */
function loadGray(path: string): Gray {
  const d = jpeg.decode(new Uint8Array(readFileSync(path)), { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 2048 });
  const ch = d.data.length / (d.width * d.height);
  const g = new Float32Array(d.width * d.height);
  for (let i = 0; i < g.length; i++) {
    const o = i * ch;
    g[i] = ch >= 3 ? (0.2126 * (d.data[o] as number) + 0.7152 * (d.data[o + 1] as number) + 0.0722 * (d.data[o + 2] as number)) / 255 : (d.data[o] as number) / 255;
  }
  return { w: d.width, h: d.height, g };
}

/** A square crop (centre cx,cy; side `side` source pixels), box-filtered down to `out × out`. Pixels outside the source read as 0.5. */
function cropSquare(src: Gray, cx: number, cy: number, side: number, out: number): Float32Array {
  const res = new Float32Array(out * out);
  const k = side / out;
  const x0 = cx - side / 2;
  const y0 = cy - side / 2;
  for (let y = 0; y < out; y++)
    for (let x = 0; x < out; x++) {
      const xa = x0 + x * k;
      const ya = y0 + y * k;
      let sum = 0;
      let wsum = 0;
      for (let yy = Math.floor(ya); yy < Math.ceil(ya + k); yy++) {
        const wy = Math.min(yy + 1, ya + k) - Math.max(yy, ya);
        if (wy <= 0) continue;
        for (let xx = Math.floor(xa); xx < Math.ceil(xa + k); xx++) {
          const wx = Math.min(xx + 1, xa + k) - Math.max(xx, xa);
          if (wx <= 0) continue;
          const inside = xx >= 0 && yy >= 0 && xx < src.w && yy < src.h;
          sum += (inside ? (src.g[yy * src.w + xx] as number) : 0.5) * wx * wy;
          wsum += wx * wy;
        }
      }
      res[y * out + x] = wsum ? sum / wsum : 0.5;
    }
  return res;
}

/** Plain separable Gaussian blur of a w×h field (clamped edges). */
function blur(f: Float32Array, w: number, h: number, sigma: number): Float32Array {
  return blurWeighted(f, new Float32Array(w * h).fill(1), w, h, sigma);
}

/** Pixels within the inscribed circle of a `size × size` plate. */
const inCircle = (x: number, y: number, size: number, margin = 0): boolean => Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= size / 2 - margin;

/** Smooth 2D value noise (for hand-engraved wobble). */
function vnoise(x: number, y: number, seed: number): number {
  const hash = (xi: number, yi: number) => {
    let h = Math.imul(xi | 0, 374761393) + Math.imul(yi | 0, 668265263) + Math.imul(seed | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const f = (t: number) => t * t * (3 - 2 * t);
  const u = f(x - xi);
  const v = f(y - yi);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ───────────────────────── Doré: the celestial rose ─────────────────────────

/**
 * Gustave Doré, *Paradiso* canto 31 (public domain): a circular crop of the rose around its star, re-engraved. The source is already an
 * engraving whose hatching is far below one plate pixel, so it is read as *tone* (blurred, then a steep S-curve so only the bright
 * structure — the star, the angels' wings, the bright tiers — reads as light) and cut again as a line screen whose lines run in
 * ellipses round the star, following the rose's own tiers, with a slow wobble so they look drawn. The line swells with the light:
 * lavender lines that thicken toward the star in dark, navy lines that thicken in the shadows in light. At the centre, where concentric
 * lines would only pile up into moiré, the screen gives way to a solid star and its rays, found as thin bright lines along the tangent.
 */
function darePlate(): Plate {
  const src = loadGray(darePath as string);
  const size = 780;
  const period = 4;
  const f0 = cropSquare(src, 1164, 1308, 1560, size);
  const soft = blur(f0, size, size, 2.0);
  const tone = new Float32Array(size * size);
  for (let i = 0; i < tone.length; i++) {
    const t = clamp01(((soft[i] as number) - 0.4) / 0.5);
    tone[i] = t * t * (3 - 2 * t);
  }
  const classes = new Uint8Array(size * size);
  const c = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (!inCircle(x, y, size)) continue;
      const dx = x + 0.5 - c;
      const dy = (y + 0.5 - c) * 1.12; // the rose is seen a little foreshortened
      const r = Math.hypot(dx, dy);
      const u = (r + 3.2 * (vnoise(x / 55, y / 55, 3) - 0.5) + 1.2 * (vnoise(x / 15, y / 15, 8) - 0.5)) / period;
      const fr = u - Math.floor(u);
      const t = tone[y * size + x] as number;
      // a lit line around the middle of each period, a shade line around its edge: their widths sum to < 0.9 so they never overlap
      if (Math.abs(fr - 0.5) < (t * 0.86) / 2) classes[y * size + x] = PLATE_CLASSES.lit;
      else if (Math.min(fr, 1 - fr) < ((1 - t) * 0.86) / 2) classes[y * size + x] = PLATE_CLASSES.shade;
    }
  const coreR = 11;
  const clearR = 26;
  const rayR = size * 0.27;
  const fine = blur(f0, size, size, 0.6);
  const at = (x: number, y: number) => fine[Math.min(size - 1, Math.max(0, Math.round(y))) * size + Math.min(size - 1, Math.max(0, Math.round(x)))] as number;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      const i = y * size + x;
      if (r < coreR) {
        classes[i] = PLATE_CLASSES.lit;
        continue;
      }
      if (r < clearR) classes[i] = PLATE_CLASSES.empty;
      if (r > rayR) continue;
      const tx = -dy / r;
      const ty = dx / r;
      const side = 0.5 * (at(x + tx * 2.6, y + ty * 2.6) + at(x - tx * 2.6, y - ty * 2.6));
      if ((fine[i] as number) - side > 0.05) classes[i] = PLATE_CLASSES.lit;
    }
  return { w: size, h: size, classes };
}

// ───────────────────────── Dürer: Melencolia I ─────────────────────────

/**
 * Albrecht Dürer, *Melencolia I* (public domain): a circular crop on the angel — the laurel wreath, the sidelong eye, the chin on the fist,
 * the hair. Dürer's burin lines are two to four source pixels apart, so the crop is reduced by only ~1.2× and the lines survive as lines:
 * an unsharp mask, then a threshold that follows the local mean *and* keeps the absolute tone (a dark face stays dark, white paper stays
 * paper), with a trace of blue noise in the threshold so dense hatching reads as grain rather than flat ink. The paper between the lines
 * is `lit` (lavender on ultramarine in dark) and the line is `shade` (navy ink on paper in light): a positive print either way.
 */
function durerPlate(): Plate {
  const src = loadGray(durerPath as string);
  const size = 900;
  const f0 = cropSquare(src, 2250, 1510, 1100, size);
  const soft = blur(f0, size, size, 0.5);
  const wide = blur(f0, size, size, 5);
  const bn = blueNoise(64, 31415);
  const classes = new Uint8Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (!inCircle(x, y, size)) continue;
      const i = y * size + x;
      const sharp = (soft[i] as number) + ((soft[i] as number) - (wide[i] as number)) * 1.0;
      const n = bn[(y % 64) * 64 + (x % 64)] as number;
      const threshold = (wide[i] as number) * 0.55 + 0.25 + (n - 0.5) * 0.08;
      classes[i] = sharp < threshold ? PLATE_CLASSES.shade : PLATE_CLASSES.lit;
    }
  return { w: size, h: size, classes };
}

// ───────────────────────── output ─────────────────────────

/**
 * The classes are carried in the alpha channel (white pixels, alpha 0 / 96 / 176 / 255) rather than in colours: a browser may colour-manage
 * RGB, but it never changes alpha, so the scene can read the class back exactly with `getImageData`.
 */
const PALETTE: Array<[number, number, number, number]> = [
  [0, 0, 0, 0],
  [255, 255, 255, 96], // lit
  [255, 255, 255, 176], // shade
  [255, 255, 255, 255], // edge
];

function writePlate(id: string, plate: Plate) {
  mkdirSync(OUT_DIR, { recursive: true });
  const png = encodeIndexed(plate.w, plate.h, plate.classes, PALETTE, 2);
  writeFileSync(join(OUT_DIR, `${id}.png`), png);
  console.log(`${id}.png  ${plate.w}×${plate.h}  ${(png.length / 1024).toFixed(1)} KB`);
  if (previewDir) preview(id, plate);
}

/** Review sheets (kept out of the repo): dark = lavender on ultramarine, light = navy on paper; 1× and 2×. */
function preview(id: string, plate: Plate) {
  mkdirSync(previewDir as string, { recursive: true });
  for (const theme of ['dark', 'light'] as const) {
    const S = Number(process.env.PREVIEW_SCALE ?? 2);
    const bg = theme === 'dark' ? [15, 15, 224] : [233, 231, 248];
    const ink = theme === 'dark' ? [201, 201, 238] : [13, 13, 64];
    const edge = theme === 'dark' ? [250, 250, 255] : [13, 13, 64];
    const rgba = new Uint8Array(plate.w * S * plate.h * S * 4);
    for (let y = 0; y < plate.h * S; y++)
      for (let x = 0; x < plate.w * S; x++) {
        const c = plate.classes[Math.floor(y / S) * plate.w + Math.floor(x / S)] as number;
        const o = (y * plate.w * S + x) * 4;
        const drawn = theme === 'dark' ? c === PLATE_CLASSES.lit : c === PLATE_CLASSES.shade;
        const col = c === PLATE_CLASSES.edge ? edge : drawn ? ink : bg;
        rgba[o] = col[0] as number;
        rgba[o + 1] = col[1] as number;
        rgba[o + 2] = col[2] as number;
        rgba[o + 3] = 255;
      }
    writeFileSync(join(previewDir as string, `${id}-${theme}.png`), encodeRgba(plate.w * S, plate.h * S, rgba));
  }
}

const jobs: Array<[string, () => Plate]> = [['marcus', marcusPlate]];
if (darePath) jobs.push(['rose', darePlate]);
if (durerPath) jobs.push(['melencolia', durerPlate]);
for (const [id, build] of jobs) if (!only || only === id || (only === 'dore' && id === 'rose') || (only === 'durer' && id === 'melencolia')) writePlate(id, build());
