/** Canvas and pixel-buffer helpers shared by the scenes. */
import { hexToRgb, type RGB } from './colors';

/** Little-endian ABGR word for a colour, for writing straight into an `ImageData` through a `Uint32Array`. (Every browser we ship to is little-endian.) */
export const packRgb = ([r, g, b]: RGB, a = 255): number =>
  ((a & 255) << 24) | ((Math.round(b) & 255) << 16) | ((Math.round(g) & 255) << 8) | (Math.round(r) & 255);
export const packHex = (hex: string, a = 255): number => packRgb(hexToRgb(hex), a);

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** A canvas filled by `paint(words, w, h)`, where `words` is the pixel buffer (transparent = 0). */
export function bakeCanvas(w: number, h: number, paint: (words: Uint32Array, w: number, h: number) => void): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  if (!ctx) return c;
  const img = ctx.createImageData(c.width, c.height);
  paint(new Uint32Array(img.data.buffer), c.width, c.height);
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Free a baked canvas's pixel memory right away (rather than waiting for the garbage collector). */
export function releaseCanvas(c: HTMLCanvasElement | null | undefined): void {
  if (c) {
    c.width = 1;
    c.height = 1;
  }
}
