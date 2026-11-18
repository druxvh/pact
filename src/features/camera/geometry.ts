/** Crop and size maths for photos and videos. Pure, so it can be tested without a camera or a canvas. */
export type AspectId = 'original' | '1:1' | '4:3' | '16:9';

export const ASPECTS: ReadonlyArray<{ id: AspectId; label: string; ratio: number | null }> = [
  { id: 'original', label: 'Original', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

export const isAspectId = (v: unknown): v is AspectId => v === 'original' || v === '1:1' || v === '4:3' || v === '16:9';
export const aspectRatio = (id: AspectId): number | null => ASPECTS.find((a) => a.id === id)?.ratio ?? null;

export type Rect = { sx: number; sy: number; sw: number; sh: number };

/**
 * The centred rectangle of a `srcW × srcH` frame that has the given aspect ratio (width / height). `null` keeps the whole frame.
 * Even sizes: video encoders are happier with them.
 */
export function cropRect(srcW: number, srcH: number, ratio: number | null): Rect {
  if (!(srcW > 0) || !(srcH > 0)) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  if (ratio === null || !(ratio > 0)) return { sx: 0, sy: 0, sw: srcW, sh: srcH };
  const srcRatio = srcW / srcH;
  let sw = srcW;
  let sh = srcH;
  if (srcRatio > ratio) sw = Math.round(srcH * ratio);
  else sh = Math.round(srcW / ratio);
  sw = Math.min(srcW, sw - (sw % 2));
  sh = Math.min(srcH, sh - (sh % 2));
  return { sx: Math.floor((srcW - sw) / 2), sy: Math.floor((srcH - sh) / 2), sw, sh };
}

/** The size to draw a crop at: the same pixels, unless the long edge exceeds `maxEdge` (then scaled down, never up). */
export function outputSize(sw: number, sh: number, maxEdge = 4096): { width: number; height: number } {
  const long = Math.max(sw, sh);
  if (!(long > 0)) return { width: 0, height: 0 };
  const k = long > maxEdge ? maxEdge / long : 1;
  const even = (n: number) => Math.max(2, Math.round(n * k) - (Math.round(n * k) % 2));
  return k === 1 ? { width: sw, height: sh } : { width: even(sw), height: even(sh) };
}

/** Longest edge of a gallery thumbnail. */
export const THUMB_EDGE = 320;

export function thumbSize(width: number, height: number, edge = THUMB_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (!(long > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, edge / long);
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
