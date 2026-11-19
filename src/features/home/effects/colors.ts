import type { Rgb } from './types';

let scratch: CanvasRenderingContext2D | null = null;

/** Any CSS colour (including `oklch(…)`) → sRGB, by letting the canvas parse it. Falls back when the string isn't a colour. */
export function toRgb(css: string, fallback: Rgb = [255, 122, 24]): Rgb {
  if (!css) return fallback;
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (hex) {
    const n = Number.parseInt(hex[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  try {
    scratch ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!scratch) return fallback;
    scratch.canvas.width = 1;
    scratch.canvas.height = 1;
    scratch.clearRect(0, 0, 1, 1);
    scratch.fillStyle = '#010203';
    scratch.fillStyle = css;
    scratch.fillRect(0, 0, 1, 1);
    const d = scratch.getImageData(0, 0, 1, 1).data;
    return [d[0] as number, d[1] as number, d[2] as number];
  } catch {
    return fallback;
  }
}

export const rgba = (c: Rgb, a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Mix towards white by `t` (0 → colour, 1 → white). */
export const lighten = (c: Rgb, t: number): Rgb => [
  Math.round(c[0] + (255 - c[0]) * t),
  Math.round(c[1] + (255 - c[1]) * t),
  Math.round(c[2] + (255 - c[2]) * t),
];
