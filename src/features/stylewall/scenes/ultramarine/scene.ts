/**
 * Scene "Engraved Halo": a page of an engraver's folio, alive. A large halo of ~2000 hairlines (gathered in sheaves, ragged at the edges)
 * radiates from a roundel holding a stippled bust; around it, an orrery of etched rings with tick marks, tiny glyph boxes and orbiting
 * bodies; dust and stars drift and twinkle; the whole sits on ink-navy with a boiling film grain. Dark is electric ultramarine and lavender
 * line on navy; light is navy ink on pale lavender paper.
 *
 * Technique. Smooth canvas (≈ 1.4× CSS pixels, capped at ~2.8 M pixels). The bust is a pre-built *plate* (plates.ts: a blue-noise stipple
 * made offline), recoloured once per theme into small sprites. The halo's rays are five Path2Ds, one per line weight, built once at resize
 * and stroked each frame under a rotation (each weight turns at its own imperceptible speed, so the lines slide past each other and the
 * field shimmers); the rings are the same, one path each. A radial stipple "glow" (blue-noise thresholded dots, baked at half resolution so
 * the dots read as ink) sits behind. Grain is four tiled noise tiles, swapped at ~8 fps — the boil. Pointer parallax shifts the layers by
 * depth: the figure moves inside its fixed roundel like a view through a window.
 *
 * Light↔dark: palettes are lerped by `options.dark` every frame; the two bitmap variants (figure, glow, grain) are cross-faded with alpha.
 */
import { mixRgb, type RGB, rgbCss } from '../../colors';
import { blueNoise } from '../../dither';
import { makeCanvas, releaseCanvas } from '../../pixels';
import { DEFAULT_PLATE, loadPlateClasses, PLATE_CLASS, type PlateDef, plateById } from '../../plates';
import { clamp } from '../../rng';
import type { SceneFactory, SceneSize } from '../../types';
import { DUST_STRIDE, generateDust } from './dust';
import { mixPalette, paletteFor, type UltraPalette } from './palette';
import { generateRays, RAY_STRIDE } from './rays';
import { makeBodies, RINGS, ringSegments } from './rings';
import { glowMask, grainTile, roundelDots } from './stipple';

const TAU = Math.PI * 2;
const BN_SIZE = 48;
let blueNoiseTile: Float32Array | null = null;
const bn = (): Float32Array => {
  if (!blueNoiseTile) blueNoiseTile = blueNoise(BN_SIZE, 7);
  return blueNoiseTile;
};

/** The orrery plate ends at this radius (R0 units); the rays begin beyond it. */
const PLATE_OUTER = 1.66;

/** Tilted elliptical orbits behind the halo: semi-axes in R0 units, a tilt that precesses, and a body that travels along each. */
const ORBITS = [
  { a: 2.5, b: 1.25, tilt: 0.5, precess: 0.0011, alpha: 0.32, phase: 0.8, speed: 0.012 },
  { a: 3.1, b: 1.05, tilt: 2.2, precess: -0.0008, alpha: 0.26, phase: 3.1, speed: -0.008 },
  { a: 2.1, b: 1.7, tilt: 1.35, precess: 0.0006, alpha: 0.3, phase: 5.2, speed: 0.016 },
] as const;

/** Total canvas pixels we will spend on a smooth full-viewport scene. */
const MAX_PIXELS = 2.8e6;

/** The internal resolution: CSS pixels × a scale of up to 2 (the device pixel ratio), shrunk so the canvas stays under ~2.8 M pixels. */
export function ultraSize(vw: number, vh: number, dpr: number): SceneSize {
  const s = Math.max(1, Math.min(2, dpr, Math.sqrt(MAX_PIXELS / Math.max(1, vw * vh))));
  return { w: Math.max(16, Math.round(vw * s)), h: Math.max(16, Math.round(vh * s)), smooth: true };
}

export type UltraLayout = { cx: number; cy: number; R0: number; portrait: boolean };

/** Where the halo's centre and the roundel's radius fall on a canvas. */
export function ultraLayout(w: number, h: number): UltraLayout {
  const portrait = w < h * 0.9;
  const m = Math.min(w, h * 1.08);
  // Landscape: the halo sits right of centre, so the clock and search box stay on the calm part of the field and the art shows beside them.
  return { cx: w * (portrait ? 0.5 : 0.79), cy: h * (portrait ? 0.4 : 0.5), R0: m * (portrait ? 0.31 : 0.235), portrait };
}

type FigureSprite = { dark: HTMLCanvasElement; light: HTMLCanvasElement; def: PlateDef };

export const create: SceneFactory = ({ ctx, options, seed }) => {
  let W = 0;
  let H = 0;
  let S = 1; // canvas px per CSS px
  let L: UltraLayout = ultraLayout(16, 16);
  let disposed = false;

  const rays = generateRays(seed);
  const dust = generateDust(seed);
  const bodies = makeBodies(seed);

  let rayPaths: Path2D[] = [];
  let rayTails: Path2D[] = [];
  let orbitPaths: Path2D[] = [];
  let ringLines: Path2D[] = [];
  let ringDots: Array<Path2D | null> = [];

  let pal = { dark: paletteFor(options.accent, true), light: paletteFor(options.accent, false), accent: options.accent };
  let figure: FigureSprite | null = null;
  let figureDef: PlateDef = plateById(options.plate || DEFAULT_PLATE);
  let planeClasses: Uint8Array | null = null;
  let glow: { dark: HTMLCanvasElement; light: HTMLCanvasElement } | null = null;
  let glowSize = 0;
  let ground: { dark: HTMLCanvasElement; light: HTMLCanvasElement } | null = null;
  let grain: { dark: CanvasPattern[]; light: CanvasPattern[] } | null = null;
  let grainCanvases: HTMLCanvasElement[] = [];
  let vignette: { dark: CanvasGradient; light: CanvasGradient } | null = null;
  let bgGrad: { dark: CanvasGradient; light: CanvasGradient } | null = null;

  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((r) => {
    resolveReady = r;
  });

  const loadPlate = (id: string) => {
    figureDef = plateById(id || DEFAULT_PLATE);
    const def = figureDef;
    void loadPlateClasses(def)
      .then((classes) => {
        if (disposed || def !== figureDef) return;
        planeClasses = classes;
        buildFigure();
      })
      .catch(() => {})
      .finally(() => resolveReady());
  };

  // ───────────────────────── baking ─────────────────────────

  /** Recolour the plate's class map into a small canvas per theme (the bust is a sprite of dots). */
  const buildFigure = () => {
    if (!planeClasses) return;
    const def = figureDef;
    if (figure) {
      releaseCanvas(figure.dark);
      releaseCanvas(figure.light);
    }
    const make = (dark: boolean) => {
      const c = makeCanvas(def.w, def.h);
      const g = c.getContext('2d');
      if (!g) return c;
      const img = g.createImageData(def.w, def.h);
      const words = new Uint32Array(img.data.buffer);
      const p = dark ? pal.dark : pal.light;
      const dot = pack(p.figure, dark ? 255 : 235);
      const edge = pack(dark ? p.bright : p.ink, 255);
      const want = dark ? PLATE_CLASS.lit : PLATE_CLASS.shade;
      for (let i = 0; i < words.length; i++) {
        const k = planeClasses?.[i];
        words[i] = k === want ? dot : k === PLATE_CLASS.edge ? edge : 0;
      }
      g.putImageData(img, 0, 0);
      return c;
    };
    figure = { dark: make(true), light: make(false), def };
  };

  const pack = ([r, g, b]: RGB, a: number): number => ((a & 255) << 24) | ((Math.round(b) & 255) << 16) | ((Math.round(g) & 255) << 8) | (Math.round(r) & 255);

  const buildGlow = () => {
    if (glow) {
      releaseCanvas(glow.dark);
      releaseCanvas(glow.light);
    }
    glowSize = Math.max(32, Math.round((L.R0 * 2 * 2.5) / 2)); // half resolution: each dot is 2 canvas px
    const mask = glowMask(glowSize, bn(), BN_SIZE, seed, 0.3, 0.8);
    const make = (dark: boolean) => {
      const c = makeCanvas(glowSize, glowSize);
      const g = c.getContext('2d');
      if (!g) return c;
      const img = g.createImageData(glowSize, glowSize);
      const words = new Uint32Array(img.data.buffer);
      const p = dark ? pal.dark : pal.light;
      const w = pack(dark ? mixRgb(p.ink, p.field, 0.38) : p.ink, dark ? 235 : 150);
      for (let i = 0; i < words.length; i++) if (mask[i]) words[i] = w;
      g.putImageData(img, 0, 0);
      return c;
    };
    glow = { dark: make(true), light: make(false) };
  };

  /** The roundel's ground: ultramarine (paper-tint in light) with a stipple aureole behind the head and dark dots toward the rim. */
  const buildGround = () => {
    if (ground) {
      releaseCanvas(ground.dark);
      releaseCanvas(ground.light);
    }
    const size = Math.max(32, Math.round(L.R0 * 2.06));
    const dots = roundelDots(size, bn(), BN_SIZE);
    const make = (dark: boolean) => {
      const c = makeCanvas(size, size);
      const g = c.getContext('2d');
      if (!g) return c;
      const p = dark ? pal.dark : pal.light;
      const img = g.createImageData(size, size);
      const words = new Uint32Array(img.data.buffer);
      const lightDot = pack(mixRgb(p.ground, dark ? p.ink : [255, 255, 255], dark ? 0.55 : 0.75), 255);
      const darkDot = pack(mixRgb(p.ground, dark ? p.field : p.ink, dark ? 0.62 : 0.16), 255);
      for (let i = 0; i < words.length; i++) {
        const k = dots[i];
        if (k === 1) words[i] = lightDot;
        else if (k === 2) words[i] = darkDot;
      }
      g.putImageData(img, 0, 0);
      return c;
    };
    ground = { dark: make(true), light: make(false) };
  };

  const buildGrain = () => {
    for (const c of grainCanvases) releaseCanvas(c);
    grainCanvases = [];
    const dark: CanvasPattern[] = [];
    const light: CanvasPattern[] = [];
    const size = 192;
    for (let v = 0; v < 4; v++) {
      const tile = grainTile(size, seed + v * 101);
      for (const isDark of [true, false]) {
        const c = makeCanvas(size, size);
        const g = c.getContext('2d');
        if (!g) continue;
        const img = g.createImageData(size, size);
        const words = new Uint32Array(img.data.buffer);
        const col = isDark ? pal.dark.bright : pal.light.ink;
        const max = isDark ? 0.55 : 0.42;
        for (let i = 0; i < words.length; i++) {
          const a = tile[i] as number;
          if (a) words[i] = pack(col, Math.round(a * max));
        }
        g.putImageData(img, 0, 0);
        grainCanvases.push(c);
        const pat = ctx.createPattern(c, 'repeat');
        if (pat) (isDark ? dark : light).push(pat);
      }
    }
    grain = { dark, light };
  };

  const buildGradients = () => {
    const mk = (p: UltraPalette) => {
      const bg = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, L.R0 * 3.4);
      bg.addColorStop(0, rgbCss(p.glow));
      bg.addColorStop(0.55, rgbCss(mixRgb(p.glow, p.field, 0.6), 0.55));
      bg.addColorStop(1, rgbCss(p.field, 0));
      const vg = ctx.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.32, W / 2, H * 0.48, Math.hypot(W, H) * 0.56);
      vg.addColorStop(0, rgbCss(p.field, 0));
      vg.addColorStop(1, rgbCss(p.field, 0.78));
      return { bg, vg };
    };
    const d = mk(pal.dark);
    const l = mk(pal.light);
    bgGrad = { dark: d.bg, light: l.bg };
    vignette = { dark: d.vg, light: l.vg };
  };

  /** Rays and rings as Path2Ds in a frame centred on the halo (canvas px). */
  const buildPaths = () => {
    const R = L.R0;
    rayTails = [];
    rayPaths = rays.map((b) => {
      const p = new Path2D();
      const tail = new Path2D();
      for (let i = 0; i < b.rays.length; i += RAY_STRIDE) {
        const a = b.rays[i] as number;
        const r0 = (b.rays[i + 1] as number) * R;
        const r1 = (b.rays[i + 2] as number) * R;
        const lean = b.rays[i + 3] as number;
        const rm = r0 + (r1 - r0) * 0.55;
        const am = a + lean * 0.55;
        p.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        p.lineTo(Math.cos(am) * rm, Math.sin(am) * rm);
        tail.moveTo(Math.cos(am) * rm, Math.sin(am) * rm);
        tail.lineTo(Math.cos(a + lean) * r1, Math.sin(a + lean) * r1);
      }
      rayTails.push(tail);
      return p;
    });
    orbitPaths = ORBITS.map((o) => {
      const p = new Path2D();
      p.ellipse(0, 0, o.a * R, o.b * R, 0, 0, TAU);
      return p;
    });
    ringLines = [];
    ringDots = [];
    RINGS.forEach((spec, i) => {
      const lines = new Path2D();
      if (spec.circle) {
        lines.moveTo(spec.r * R, 0);
        lines.arc(0, 0, spec.r * R, 0, TAU);
      }
      for (const [x0, y0, x1, y1] of ringSegments(spec, i, seed)) {
        lines.moveTo(x0 * R, y0 * R);
        lines.lineTo(x1 * R, y1 * R);
      }
      ringLines.push(lines);
      if (spec.dots) {
        const d = new Path2D();
        for (let k = 0; k < spec.dots.count; k++) {
          const a = (k / spec.dots.count) * TAU;
          const big = k % (spec.dots.count / 4) === 0;
          const rr = spec.r * R;
          const x = Math.cos(a) * rr;
          const y = Math.sin(a) * rr;
          d.moveTo(x, y);
          d.lineTo(x + (big ? 0.001 : 0.001), y);
        }
        ringDots.push(d);
      } else ringDots.push(null);
    });
  };

  const rebuildColour = () => {
    pal = { dark: paletteFor(options.accent, true), light: paletteFor(options.accent, false), accent: options.accent };
    buildFigure();
    buildGlow();
    buildGround();
    buildGrain();
    buildGradients();
  };

  // ───────────────────────── frame ─────────────────────────

  const fillField = (p: UltraPalette, alpha: number, grad: CanvasGradient | undefined) => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = rgbCss(p.field);
    ctx.fillRect(0, 0, W, H);
    if (grad) {
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  };

  const frame = (t: number) => {
    if (disposed || W === 0) return;
    if (options.accent !== pal.accent) rebuildColour();
    if (options.plate !== '' && plateById(options.plate) !== figureDef) loadPlate(options.plate);
    const m = clamp(options.dark, 0, 1);
    // Mid-way between themes the line colours would mix to a weak grey on a grey field, so the *lines* dip out and back in instead:
    // the field, glow and ground lerp, while ink, rings and dust take the nearer theme's colour and fade through zero at the crossover.
    const dip = Math.abs(m * 2 - 1) ** 0.7;
    const nearer = m >= 0.5 ? pal.dark : pal.light;
    const p = mixPalette(pal.light, pal.dark, m);
    p.ink = nearer.ink;
    p.bright = nearer.bright;
    p.line = nearer.line;
    p.figure = nearer.figure;
    p.rayAlpha *= dip;
    const px = options.px;
    const py = options.py;
    const R = L.R0;
    const s = S;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // 1. field and its soft glow (cross-faded between the two themes)
    fillField(pal.light, 1, bgGrad?.light);
    if (m > 0.001) fillField(pal.dark, m, bgGrad?.dark);

    // 2. the celestial diagram behind everything: tilted orbits that precess slowly, each with a body travelling along it
    const ox = L.cx + px * -6 * s;
    const oy = L.cy + py * -4.5 * s;
    ctx.lineCap = 'butt';
    ctx.lineWidth = 0.8 * s;
    for (let i = 0; i < ORBITS.length; i++) {
      const o = ORBITS[i] as (typeof ORBITS)[number];
      const a = o.tilt + t * o.precess;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      ctx.setTransform(c, sn, -sn, c, ox, oy);
      ctx.strokeStyle = rgbCss(p.line, o.alpha * p.rayAlpha);
      ctx.stroke(orbitPaths[i] as Path2D);
      const ang = o.phase + t * o.speed;
      const bx = Math.cos(ang) * o.a * R;
      const by = Math.sin(ang) * o.b * R;
      ctx.fillStyle = rgbCss(p.bright);
      ctx.beginPath();
      ctx.arc(bx, by, 2.6 * s, 0, TAU);
      ctx.fill();
    }

    // 3. rays: five weights, each turning at its own pace and breathing in alpha; the outer half of every ray is drawn a weight lighter (a taper)
    for (let i = 0; i < rayPaths.length; i++) {
      const b = rays[i];
      if (!b) continue;
      const a = t * b.speed;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      ctx.setTransform(c, sn, -sn, c, ox, oy);
      const breath = 1 + b.breath.amp * Math.sin(t * b.breath.rate + b.breath.phase);
      const col = i >= 3 ? p.bright : p.ink;
      ctx.lineWidth = b.width * s;
      ctx.strokeStyle = rgbCss(col, clamp(b.alpha * breath * p.rayAlpha, 0, 1));
      ctx.stroke(rayPaths[i] as Path2D);
      const tail = rayTails[i];
      if (tail) {
        ctx.lineWidth = b.width * 0.55 * s;
        ctx.strokeStyle = rgbCss(col, clamp(b.alpha * 0.6 * breath * p.rayAlpha, 0, 1));
        ctx.stroke(tail);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 4. the orrery plate: the rays stop at its rim, so the rings, ticks and glyph boxes read against a quiet ground
    const rx = L.cx + px * -9 * s;
    const ry = L.cy + py * -7 * s;
    ctx.fillStyle = rgbCss(p.field);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(rx, ry, R * PLATE_OUTER, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 5. stipple glow over the plate and a little beyond it, breathing
    if (glow) {
      const breathe = 0.82 + 0.18 * Math.sin(t * 0.21);
      const gx = rx - glowSize;
      const gy = ry - glowSize;
      ctx.imageSmoothingEnabled = false;
      if (m < 0.999) {
        ctx.globalAlpha = (1 - m) * breathe;
        ctx.drawImage(glow.light, gx, gy, glowSize * 2, glowSize * 2);
      }
      if (m > 0.001) {
        ctx.globalAlpha = m * breathe;
        ctx.drawImage(glow.dark, gx, gy, glowSize * 2, glowSize * 2);
      }
      ctx.globalAlpha = 1;
    }

    // 6. rings, ticks, glyph boxes, dotted circles
    for (let i = 0; i < RINGS.length; i++) {
      const spec = RINGS[i];
      if (!spec) continue;
      const a = t * spec.speed;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      ctx.setTransform(c, sn, -sn, c, rx, ry);
      ctx.lineWidth = (i === 0 ? 1.5 : 0.95) * s;
      ctx.strokeStyle = rgbCss(i < 2 ? p.bright : p.line, Math.min(1, spec.alpha * 1.15 * dip));
      ctx.stroke(ringLines[i] as Path2D);
      const dots = ringDots[i];
      if (dots && spec.dots) {
        ctx.lineCap = 'round';
        ctx.lineWidth = spec.dots.size * R * 2;
        ctx.strokeStyle = rgbCss(p.line, spec.alpha * dip);
        ctx.stroke(dots);
        ctx.lineCap = 'butt';
      }
    }
    // orbiting bodies on the rings: a small ring with a dot, travelling (the one thing whose motion you can follow with your eye)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < bodies.length; i++) {
      const bd = bodies[i];
      const ring = bd ? RINGS[bd.ring] : undefined;
      if (!bd || !ring) continue;
      const a = bd.angle + t * bd.speed;
      const bx = rx + Math.cos(a) * ring.r * R;
      const by = ry + Math.sin(a) * ring.r * R;
      const r = bd.size * R;
      ctx.fillStyle = rgbCss(p.field);
      ctx.beginPath();
      ctx.arc(bx, by, r * 1.9, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = rgbCss(p.bright, 0.95 * dip);
      ctx.lineWidth = 1 * s;
      ctx.stroke();
      ctx.fillStyle = rgbCss(p.bright);
      ctx.beginPath();
      ctx.arc(bx, by, r * 0.8, 0, TAU);
      ctx.fill();
    }

    // 7. the roundel: a textured ground, the figure moving inside it like a view through a window
    ctx.save();
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, R * 1.03, 0, TAU);
    ctx.fillStyle = rgbCss(p.ground);
    ctx.fill();
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    if (ground && !figure?.def.flat) {
      const gs = ground.dark.width;
      if (m < 0.999) {
        ctx.drawImage(ground.light, L.cx - gs / 2, L.cy - gs / 2);
      }
      if (m > 0.001) {
        ctx.globalAlpha = m;
        ctx.drawImage(ground.dark, L.cx - gs / 2, L.cy - gs / 2);
        ctx.globalAlpha = 1;
      }
    }
    if (figure) {
      // the sprite's own placement: while a new plate is still decoding, the old one keeps its size
      const def = figure.def;
      const ph = def.fill * R * 2;
      const pw = (ph * def.w) / def.h;
      // a bust moves freely in its window; a plate that fills the roundel moves only within its small margin (fill 1.07 > the 1.03 clip)
      const sx = def.flat ? R * 0.025 : 14 * s;
      const sy = def.flat ? R * 0.018 : 9 * s;
      const fx = L.cx - pw / 2 + px * -sx;
      const fy = L.cy - R * 1.03 + (R * 2.06 - ph) * def.valign + py * -sy;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = m > 0.001 && m < 0.999 ? 'low' : 'high'; // cheaper while two copies are being cross-faded
      if (m < 0.999) {
        ctx.globalAlpha = 1 - m;
        ctx.drawImage(figure.light, fx, fy, pw, ph);
      }
      if (m > 0.001) {
        ctx.globalAlpha = m;
        ctx.drawImage(figure.dark, fx, fy, pw, ph);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // 8. drifting dust and stars
    ctx.fillStyle = rgbCss(p.bright);
    const dx = px * -22 * s;
    const dy = py * -16 * s;
    for (let i = 0; i < dust.count; i++) {
      const o = i * DUST_STRIDE;
      const r = (dust.data[o] as number) * R;
      const a = (dust.data[o + 1] as number) + t * (dust.data[o + 2] as number);
      const x = L.cx + Math.cos(a) * r + dx;
      const y = L.cy + Math.sin(a) * r * 0.92 + dy;
      if (x < -6 || y < -6 || x > W + 6 || y > H + 6) continue;
      const tw = 0.5 + 0.5 * Math.sin(t * (dust.data[o + 4] as number) + (dust.data[o + 5] as number));
      const size = (dust.data[o + 3] as number) * s;
      const sparkle = (dust.data[o + 6] as number) === 1;
      ctx.globalAlpha = ((sparkle ? 0.6 : 0.3) + (sparkle ? 0.4 : 0.7) * tw * tw) * dip;
      if (sparkle) {
        const len = size * (1.6 + tw);
        ctx.fillRect(x - len, y - 0.5 * s, len * 2, 1 * s);
        ctx.fillRect(x - 0.5 * s, y - len, 1 * s, len * 2);
      } else ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;

    // 9. film grain: four tiles, a new one every ~125 ms at a new offset (the boil). While the theme crossfades only the nearer
    //    theme's grain is drawn: grain looks alike in both, and a full-canvas pattern fill is the dearest thing in the frame.
    if (grain) {
      const step = Math.floor(t * 8);
      const k = step & 3;
      const gx = (step * 71) % 192;
      const gy = (step * 113) % 192;
      const pat = m >= 0.5 ? grain.dark[k] : grain.light[k];
      if (pat) {
        ctx.save();
        ctx.translate(-gx, -gy);
        ctx.fillStyle = pat;
        ctx.fillRect(gx, gy, W, H);
        ctx.restore();
      }
    }

    // 10. vignette (likewise: the nearer theme's)
    if (vignette) {
      ctx.fillStyle = m >= 0.5 ? vignette.dark : vignette.light;
      ctx.fillRect(0, 0, W, H);
    }
  };

  loadPlate(options.plate || DEFAULT_PLATE);

  return {
    fps: 30,
    stillTime: 24,
    ready,
    size: (vw, vh, dpr) => {
      const sz = ultraSize(vw, vh, dpr);
      S = sz.w / Math.max(1, vw); // canvas pixels per CSS pixel, for line widths and parallax
      return sz;
    },
    resize(w, h) {
      W = w;
      H = h;
      L = ultraLayout(w, h);
      buildPaths();
      rebuildColour();
    },
    frame,
    dispose() {
      disposed = true;
      if (figure) {
        releaseCanvas(figure.dark);
        releaseCanvas(figure.light);
      }
      if (glow) {
        releaseCanvas(glow.dark);
        releaseCanvas(glow.light);
      }
      for (const c of grainCanvases) releaseCanvas(c);
      figure = null;
      if (ground) {
        releaseCanvas(ground.dark);
        releaseCanvas(ground.light);
      }
      ground = null;
      glow = null;
      grain = null;
      vignette = null;
      bgGrad = null;
      rayPaths = [];
      rayTails = [];
      orbitPaths = [];
      ringLines = [];
      ringDots = [];
    },
  };
};
