/**
 * Where watermark text goes on a page — the one function both the live preview and the stamped PDF use, so what you
 * see is what you get.
 *
 * Everything here is in what the *viewer* sees: points, origin at the bottom-left of the visible page, y up, angles
 * counter-clockwise. The PDF side maps those points into the page's own (possibly rotated) coordinate space with
 * `pointToUser`; the preview just flips y. No pdf-lib, no DOM.
 */
import type { WatermarkPosition } from './types';

/** Advance widths in em (1 = the font size) for each character a standard PDF font can draw — measured in the worker. */
export type FontWidths = Record<string, number>;
export type FontMetrics = { regular: FontWidths; bold: FontWidths };

/** Cap height of Helvetica as a fraction of the font size; the text's visual box is this tall, sitting on the baseline. */
export const CAP_HEIGHT = 0.72;
export const MAX_TEXT_LENGTH = 80;
export const MIN_SIZE = 6;
export const MAX_SIZE = 300;
const MAX_STAMPS = 3000;

/** One line of text: newlines and runs of spaces collapse, so what's measured is what's drawn. */
export const cleanText = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Characters of `text` the standard font can't draw (everything outside Latin-1-ish "WinAnsi"), without repeats. */
export function unsupportedChars(text: string, widths: FontWidths): string[] {
  return [...new Set(Array.from(text).filter((ch) => widths[ch] === undefined))];
}

/** Width of `text` at `size` points (no kerning — the PDF text operator doesn't apply any either). */
export function textWidth(text: string, size: number, widths: FontWidths): number {
  let em = 0;
  for (const ch of text) em += widths[ch] ?? 0;
  return em * size;
}

export type PageSize = { width: number; height: number };
/** Origin = where the text's baseline starts (the PDF text origin); `angle` is counter-clockwise degrees. */
export type Stamp = { x: number; y: number; angle: number };

export type LayoutOptions = {
  rotation: number;
  layout: 'single' | 'tiled';
  position: WatermarkPosition;
};

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Half the width/height of the axis-aligned box around a `w` × `h` box turned by `angle`. */
function halfExtents(w: number, h: number, angle: number): { hw: number; hh: number } {
  const c = Math.abs(Math.cos(rad(angle)));
  const s = Math.abs(Math.sin(rad(angle)));
  return { hw: (w * c + h * s) / 2, hh: (w * s + h * c) / 2 };
}

/** The stamp whose text box (w × h) is centred on (cx, cy). */
function centredAt(cx: number, cy: number, w: number, h: number, angle: number): Stamp {
  const a = rad(angle);
  const dx = (w / 2) * Math.cos(a) - (h / 2) * Math.sin(a);
  const dy = (w / 2) * Math.sin(a) + (h / 2) * Math.cos(a);
  return { x: cx - dx, y: cy - dy, angle };
}

/** Every copy of the text to draw on a page of `page` points, for text `w` wide and `h` tall (see `CAP_HEIGHT`). */
export function layoutStamps(page: PageSize, w: number, h: number, opts: LayoutOptions): Stamp[] {
  const { width: W, height: H } = page;
  const angle = opts.rotation;
  const { hw, hh } = halfExtents(w, h, angle);

  if (opts.layout === 'single') {
    const margin = Math.max(12, Math.min(W, H) * 0.04);
    const [row, col] = splitPosition(opts.position);
    const [left, right, bottom, top] = [margin + hw, W - margin - hw, margin + hh, H - margin - hh];
    // A box too big for the page (once the margin is kept) is centred on that axis rather than hanging off one side.
    const cx = left > right || col === 'center' ? W / 2 : col === 'left' ? left : right;
    const cy = bottom > top || row === 'center' ? H / 2 : row === 'bottom' ? bottom : top;
    return [centredAt(cx, cy, w, h, angle)];
  }

  // Tiled: a lattice aligned with the text (rows run along the text), every other row shifted by half a step.
  let stepX = w * 1.35 + h * 2;
  let stepY = h * 5;
  const estimate = (W * H) / (stepX * stepY);
  if (estimate > MAX_STAMPS) {
    const grow = Math.sqrt(estimate / MAX_STAMPS);
    stepX *= grow;
    stepY *= grow;
  }
  const a = rad(angle);
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const reach = Math.hypot(W, H) / 2 + Math.hypot(hw, hh);
  const nI = Math.ceil(reach / stepX) + 1;
  const nJ = Math.ceil(reach / stepY) + 1;
  const out: Stamp[] = [];
  for (let j = -nJ; j <= nJ; j++) {
    const shift = Math.abs(j) % 2 === 1 ? stepX / 2 : 0;
    for (let i = -nI; i <= nI; i++) {
      const along = i * stepX + shift;
      const across = j * stepY;
      const cx = W / 2 + along * ux - across * uy;
      const cy = H / 2 + along * uy + across * ux;
      // Keep any copy that touches the page (partly cut off at the edges is how tiled watermarks look).
      if (Math.abs(cx - W / 2) < W / 2 + hw && Math.abs(cy - H / 2) < H / 2 + hh) out.push(centredAt(cx, cy, w, h, angle));
    }
  }
  return out;
}

function splitPosition(p: WatermarkPosition): ['top' | 'center' | 'bottom', 'left' | 'center' | 'right'] {
  const row = p.startsWith('top') ? 'top' : p.startsWith('bottom') ? 'bottom' : 'center';
  const col = p.endsWith('left') ? 'left' : p.endsWith('right') ? 'right' : 'center';
  return [row, col];
}

/** `#rgb` / `#rrggbb` → 0–1 channels (black for anything unreadable). */
export function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return { r: 0, g: 0, b: 0 };
  const h = m[1].length === 3 ? Array.from(m[1], (c) => c + c).join('') : m[1];
  return { r: Number.parseInt(h.slice(0, 2), 16) / 255, g: Number.parseInt(h.slice(2, 4), 16) / 255, b: Number.parseInt(h.slice(4, 6), 16) / 255 };
}
