/** Geometry for the profile-picture cropper: a square window over an image you can zoom and drag. Pure, so it's testable. */

export const AVATAR_BOX = 256; // CSS px of the cropper window
export const AVATAR_OUT = 256; // px of the saved picture
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export type Crop = { zoom: number /** image-centre offset from the window centre, in window px */; x: number; y: number };

/** Scale at which the image just covers the window. */
export const coverScale = (w: number, h: number, box = AVATAR_BOX) => Math.max(box / w, box / h);

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(z) ? z : MIN_ZOOM));

/** Keep the window fully covered by the image (no empty edges). */
export function clampCrop(w: number, h: number, crop: Crop, box = AVATAR_BOX): Crop {
  const zoom = clampZoom(crop.zoom);
  const s = coverScale(w, h, box) * zoom;
  const maxX = Math.max(0, (w * s - box) / 2);
  const maxY = Math.max(0, (h * s - box) / 2);
  // `|| 0` turns -0 into 0 (and NaN into 0), so equal crops compare equal.
  return { zoom, x: Math.min(maxX, Math.max(-maxX, crop.x)) || 0, y: Math.min(maxY, Math.max(-maxY, crop.y)) || 0 };
}

/** The square of the source image (in its own pixels) that sits inside the window. */
export function sourceRect(w: number, h: number, crop: Crop, box = AVATAR_BOX): { sx: number; sy: number; size: number } {
  const c = clampCrop(w, h, crop, box);
  const s = coverScale(w, h, box) * c.zoom;
  const size = box / s;
  return { sx: w / 2 - c.x / s - size / 2, sy: h / 2 - c.y / s - size / 2, size };
}

export const ACCEPTED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];
export const MAX_AVATAR_INPUT_BYTES = 15 * 1024 * 1024;

export function avatarFileError(file: { type: string; size: number }): string | null {
  if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) return 'Pick a PNG, JPEG, WebP, GIF or AVIF image.';
  if (file.size > MAX_AVATAR_INPUT_BYTES) return 'That image is over 15 MB — pick a smaller one.';
  return null;
}
