/**
 * Small, dependency-free OKLCH toolkit (Björn Ottosson's OKLab). Used to turn one accent colour the user picked
 * into a full set of theme tokens, and to *verify* contrast numerically — which needs conversions that match
 * what the browser renders, including gamut mapping (CSS reduces chroma for out-of-gamut colours).
 */

export type Oklch = { l: number; c: number; h: number };
export type Rgb = { r: number; g: number; b: number }; // 0–255

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

export function rgbToOklch({ r, g, b }: Rgb): Oklch {
  const lr = toLinear(r / 255);
  const lg = toLinear(g / 255);
  const lb = toLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(a, bb);
  const h = c < 1e-4 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/** Linear-light sRGB, NOT clamped — values outside 0–1 mean "out of gamut". */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const EPS = 1e-4;
const inGamut = (lin: number[]) => lin.every((v) => v >= -EPS && v <= 1 + EPS);

/** Reduce chroma until the colour fits sRGB (what browsers do for `oklch()`), keeping lightness and hue. */
export function fitToGamut(color: Oklch): Oklch {
  const l = Math.min(1, Math.max(0, color.l));
  if (l <= 0 || l >= 1) return { l, c: 0, h: color.h };
  if (inGamut(oklchToLinear({ ...color, l }))) return { ...color, l };
  let lo = 0;
  let hi = color.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToLinear({ l, c: mid, h: color.h }))) lo = mid;
    else hi = mid;
  }
  return { l, c: lo, h: color.h };
}

export function oklchToRgb(color: Oklch): Rgb {
  const lin = oklchToLinear(fitToGamut(color));
  const to255 = (v: number) => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, v))))) * 255);
  return { r: to255(lin[0]), g: to255(lin[1]), b: to255(lin[2]) };
}

/** WCAG relative luminance of an OKLCH colour (after gamut fitting, as rendered). */
export function luminanceOf(color: Oklch): number {
  const [r, g, b] = oklchToLinear(fitToGamut(color)).map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: Oklch, b: Oklch): number {
  const la = luminanceOf(a);
  const lb = luminanceOf(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const round = (n: number, d: number) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/** `oklch(0.705 0.213 47.6)` / `oklch(0.705 0.213 47.6 / 12%)` — gamut-fitted so what we measured is what renders. */
export function oklchCss(color: Oklch, alpha?: number): string {
  const f = fitToGamut(color);
  const base = `${round(f.l, 3)} ${round(f.c, 3)} ${round(f.h, 1)}`;
  return alpha === undefined || alpha >= 1 ? `oklch(${base})` : `oklch(${base} / ${round(alpha * 100, 1)}%)`;
}

export function parseHex(input: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m?.[1]) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  const n = Number.parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export const oklchToHex = (color: Oklch) => rgbToHex(oklchToRgb(color));
