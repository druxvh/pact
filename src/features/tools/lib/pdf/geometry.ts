/**
 * Page geometry for PDF tools.
 *
 * Users work on what they *see* (a rendered page, already turned by its /Rotate), but PDF drawing happens in the
 * page's unrotated "user space". Every crop and signature therefore goes through `visualToUser`, which is the
 * one place that knows how the four rotations map. Getting this wrong is how PDF tools put signatures in the wrong
 * corner on landscape scans, so it's tested exhaustively.
 */
export type Box = { x: number; y: number; width: number; height: number };

/** A rectangle as fractions (0–1) of the *visible* page, origin at its top-left. */
export type FRect = { left: number; top: number; width: number; height: number };

export type Rotation = 0 | 90 | 180 | 270;

export const normalizeRotation = (deg: number): Rotation => ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as Rotation;

/** Size of the page as displayed (width and height swap on 90°/270°). */
export function visualSize(box: Box, rotation: Rotation): { width: number; height: number } {
  return rotation === 90 || rotation === 270 ? { width: box.height, height: box.width } : { width: box.width, height: box.height };
}

/** Map a point given as visual fractions (u right, v down, from the top-left) to PDF user space. */
export function pointToUser(box: Box, rotation: Rotation, u: number, v: number): { x: number; y: number } {
  const W = box.width;
  const H = box.height;
  switch (rotation) {
    case 0:
      return { x: box.x + u * W, y: box.y + (1 - v) * H };
    case 90:
      return { x: box.x + v * W, y: box.y + u * H };
    case 180:
      return { x: box.x + (1 - u) * W, y: box.y + v * H };
    case 270:
      return { x: box.x + (1 - v) * W, y: box.y + (1 - u) * H };
  }
}

/** The user-space bounding box of a visual rectangle. */
export function visualToUser(box: Box, rotation: Rotation, r: FRect): Box {
  const a = pointToUser(box, rotation, r.left, r.top);
  const b = pointToUser(box, rotation, r.left + r.width, r.top + r.height);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Where (and how big, how turned) to draw an upright image so it appears in visual rectangle `r`. */
export function placeUpright(box: Box, rotation: Rotation, r: FRect): { x: number; y: number; width: number; height: number; angle: number } {
  const vis = visualSize(box, rotation);
  const anchor = pointToUser(box, rotation, r.left, r.top + r.height); // the image's own bottom-left corner
  return { x: anchor.x, y: anchor.y, width: r.width * vis.width, height: r.height * vis.height, angle: rotation };
}

/**
 * Shape of a signature's rectangle in *page-fraction* space (rect.width / rect.height), given the picture's own
 * width / height (`imageRatio`) and the displayed page's height / width (`pageRatio`).
 *
 * Fractions are of different lengths — a page is taller than it is wide — so a picture that is 3:1 in pixels is
 * `3 × pageRatio` : 1 in fractions. The preview (RectBox's locked aspect), the first placement and the stamped
 * output all go through this one function, so they can't drift apart (the preview once divided where it should have
 * multiplied, and signatures were squashed whenever they were resized on screen).
 */
export const fractionAspect = (imageRatio: number, pageRatio: number): number => imageRatio * pageRatio;

/** Height (as a page fraction) a rectangle of `width` needs so a picture with this `imageRatio` isn't stretched. */
export const heightForWidth = (width: number, imageRatio: number, pageRatio: number): number => width / fractionAspect(imageRatio, pageRatio);

/**
 * Re-shape `rect` to `aspect` (see `fractionAspect`) keeping its left edge, top edge and width, then pull it back on
 * the page. A rectangle that already has the right shape comes back unchanged. Used when a signature placed on one
 * page is stamped on pages of other proportions.
 */
export function fitAspect(rect: FRect, aspect: number): FRect {
  if (!(aspect > 0)) return rect;
  let width = Math.min(1, rect.width);
  let height = width / aspect;
  if (height > 1) {
    height = 1;
    width = aspect;
  }
  return clampRect({ left: rect.left, top: rect.top, width, height });
}

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Keep a rectangle fully on the page. */
export function clampRect(r: FRect): FRect {
  const width = Math.min(1, Math.max(0, r.width));
  const height = Math.min(1, Math.max(0, r.height));
  return { width, height, left: Math.min(1 - width, Math.max(0, r.left)), top: Math.min(1 - height, Math.max(0, r.top)) };
}

export type Handle = 'move' | 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export type ResizeOptions = {
  /** Smallest width / height as a fraction of the page. */
  minW?: number;
  minH?: number;
  /** Keep width/height (in page-fraction space) constant — corners only. */
  aspect?: number;
};

/**
 * Drag `handle` of `start` by (dx, dy) — page fractions — and return the new rectangle, always inside the page and
 * never smaller than the minimum. Pure, so every handle/edge/aspect combination can be tested.
 */
export function resizeRect(start: FRect, handle: Handle, dx: number, dy: number, opts: ResizeOptions = {}): FRect {
  const minW = opts.minW ?? 0.02;
  const minH = opts.minH ?? 0.02;
  if (handle === 'move') return clampRect({ ...start, left: start.left + dx, top: start.top + dy });

  let left = start.left;
  let top = start.top;
  let right = start.left + start.width;
  let bottom = start.top + start.height;

  const movesLeft = handle.includes('w');
  const movesRight = handle.includes('e');
  const movesTop = handle.includes('n');
  const movesBottom = handle.includes('s');

  if (opts.aspect && handle.length === 2) {
    // Corner with a locked shape: the opposite corner stays put; follow the larger pointer movement.
    const anchorX = movesLeft ? right : left;
    const anchorY = movesTop ? bottom : top;
    const wantW = Math.abs((movesLeft ? left + dx : right + dx) - anchorX);
    const wantH = Math.abs((movesTop ? top + dy : bottom + dy) - anchorY);
    let w = Math.max(wantW, wantH * opts.aspect, minW, minH * opts.aspect);
    const maxW = Math.min(movesLeft ? anchorX : 1 - anchorX, (movesTop ? anchorY : 1 - anchorY) * opts.aspect);
    w = Math.min(w, maxW);
    const h = w / opts.aspect;
    return { left: movesLeft ? anchorX - w : anchorX, top: movesTop ? anchorY - h : anchorY, width: w, height: h };
  }

  if (movesLeft) left = Math.min(Math.max(0, left + dx), right - minW);
  if (movesRight) right = Math.max(Math.min(1, right + dx), left + minW);
  if (movesTop) top = Math.min(Math.max(0, top + dy), bottom - minH);
  if (movesBottom) bottom = Math.max(Math.min(1, bottom + dy), top + minH);
  return { left, top, width: right - left, height: bottom - top };
}

/** Margins (fractions) ↔ rectangle, for the numeric "trim from each side" inputs. */
export const rectFromMargins = (m: { top: number; right: number; bottom: number; left: number }): FRect => ({
  left: m.left,
  top: m.top,
  width: Math.max(0, 1 - m.left - m.right),
  height: Math.max(0, 1 - m.top - m.bottom),
});
export const marginsFromRect = (r: FRect) => ({ top: r.top, left: r.left, right: 1 - r.left - r.width, bottom: 1 - r.top - r.height });
export const FULL_PAGE: FRect = { left: 0, top: 0, width: 1, height: 1 };
export const isFullPage = (r: FRect) => r.left <= 0.0005 && r.top <= 0.0005 && r.width >= 0.999 && r.height >= 0.999;
