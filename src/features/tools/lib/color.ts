/** Colour parsing, conversion and WCAG contrast. Pure functions. */
export type RGB = { r: number; g: number; b: number; a: number };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/**
 * Accepts #rgb, #rgba, #rrggbb, #rrggbbaa (with or without #), rgb()/rgba() and hsl()/hsla()
 * (comma or space separated). Returns null when it can't be understood — the old tool
 * produced `NaN:1` for anything but a 6-digit hex.
 */
export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex?.[1]) {
    let h = hex[1];
    if (h.length <= 4) h = Array.from(h, (c) => c + c).join('');
    const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? round(n(6) / 255, 3) : 1 };
  }

  const fn = /^(rgba?|hsla?)\(\s*([^)]+)\)$/.exec(s);
  if (fn?.[1] && fn[2]) {
    const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
    const num = (v: string | undefined, pct = 1) => {
      if (v === undefined) return Number.NaN;
      return v.endsWith('%') ? (Number.parseFloat(v) / 100) * pct : Number.parseFloat(v);
    };
    const alpha = parts[3] !== undefined ? clamp(num(parts[3], 1), 0, 1) : 1;
    if (fn[1].startsWith('rgb')) {
      const [r, g, b] = [num(parts[0], 255), num(parts[1], 255), num(parts[2], 255)];
      if ([r, g, b].some(Number.isNaN)) return null;
      return { r: clamp(Math.round(r), 0, 255), g: clamp(Math.round(g), 0, 255), b: clamp(Math.round(b), 0, 255), a: alpha };
    }
    const h = Number.parseFloat(parts[0] ?? '');
    const sat = num(parts[1], 1);
    const light = num(parts[2], 1);
    if ([h, sat, light].some(Number.isNaN)) return null;
    // hsl(…, 50%, 40%) or hsl(…, 0.5, 0.4)
    const sN = sat > 1 ? sat / 100 : sat;
    const lN = light > 1 ? light / 100 : light;
    return { ...hslToRgb(((h % 360) + 360) % 360, clamp(sN, 0, 1), clamp(lN, 0, 1)), a: alpha };
  }
  return null;
}

export function hslToRgb(h: number, s: number, l: number): Omit<RGB, 'a'> {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) };
}

export function rgbToHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: Math.round(((h * 60) % 360 + 360) % 360), s, l };
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function relativeLuminance({ r, g, b }: RGB): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio (1–21). Alpha is ignored — composite over the background first if needed. */
export function contrastRatio(a: RGB, b: RGB): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export type WcagLevel = { aaNormal: boolean; aaaNormal: boolean; aaLarge: boolean; aaaLarge: boolean };
export function wcag(ratio: number): WcagLevel {
  return { aaNormal: ratio >= 4.5, aaaNormal: ratio >= 7, aaLarge: ratio >= 3, aaaLarge: ratio >= 4.5 };
}

const hex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
export function toHex({ r, g, b, a }: RGB): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ''}`;
}
export function toRgbString({ r, g, b, a }: RGB): string {
  return a < 1 ? `rgb(${r} ${g} ${b} / ${round(a, 2)})` : `rgb(${r} ${g} ${b})`;
}
export function toHslString(c: RGB): string {
  const { h, s, l } = rgbToHsl(c);
  const base = `${h} ${round(s * 100)}% ${round(l * 100)}%`;
  return c.a < 1 ? `hsl(${base} / ${round(c.a, 2)})` : `hsl(${base})`;
}

/** sRGB → OKLab → OKLCH (matches CSS `oklch()`). */
export function toOklchString(c: RGB): string {
  const r = lin(c.r);
  const g = lin(c.g);
  const b = lin(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = C < 0.0004 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return `oklch(${round(L, 3)} ${round(C, 3)} ${round(H, 1)})`;
}

/** Nudge `fg` lighter/darker (in HSL lightness) until it reaches `target` contrast against `bg`. */
export function suggestForeground(fg: RGB, bg: RGB, target = 4.5): RGB {
  if (contrastRatio(fg, bg) >= target) return fg;
  const { h, s, l } = rgbToHsl(fg);
  const bgLum = relativeLuminance(bg);
  const dir = bgLum > 0.5 ? -1 : 1; // dark text on light bg, light text on dark bg
  for (let step = 1; step <= 100; step++) {
    const nl = clamp(l + dir * (step / 100), 0, 1);
    const cand = { ...hslToRgb(h, s, nl), a: 1 };
    if (contrastRatio(cand, bg) >= target) return cand;
  }
  return dir < 0 ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
}
