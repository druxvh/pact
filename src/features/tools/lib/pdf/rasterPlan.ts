/**
 * Compress PDF presets and the small pure helpers around them (no pdf-lib, no DOM — shared by the UI and the tests).
 *
 * Three honest levels:
 *  - `lossless`  keeps everything (text stays selectable, links and forms keep working); only wasted bytes are removed.
 *  - `balanced`, `small`  draw every page to a picture and rebuild the PDF from the pictures. That is what makes big
 *    files small — and it flattens the text, so it can't be selected, searched or copied any more.
 */

export type CompressLevel = 'lossless' | 'balanced' | 'small';

export type RasterSettings = {
  /** Resolution the pages are drawn at (dots per inch; PDF points are 1/72 inch). */
  dpi: number;
  /** JPEG quality, 0.1–1. */
  quality: number;
};

export const RASTER_PRESETS: Record<Exclude<CompressLevel, 'lossless'>, RasterSettings> = {
  balanced: { dpi: 110, quality: 0.72 },
  small: { dpi: 72, quality: 0.5 },
};

export const DPI_CHOICES = [72, 96, 110, 150, 200] as const;

/** Browsers refuse (or crash on) very large canvases; stay well inside what Chrome allows. */
export const MAX_SIDE_PX = 4096;
export const MAX_PIXELS = 16_000_000;

/** The pdf.js scale to draw a page of `widthPt` × `heightPt` points at, shrunk if the canvas would be too big. */
export function renderScale(widthPt: number, heightPt: number, dpi: number): number {
  const wanted = dpi / 72;
  if (!(widthPt > 0) || !(heightPt > 0)) return wanted;
  const bySide = MAX_SIDE_PX / Math.max(widthPt, heightPt);
  const byArea = Math.sqrt(MAX_PIXELS / (widthPt * heightPt));
  return Math.max(0.1, Math.min(wanted, bySide, byArea));
}

/** Percent saved, one decimal, never negative. */
export function percentSaved(before: number, after: number): number {
  if (!(before > 0) || after >= before) return 0;
  return Math.round((1 - after / before) * 1000) / 10;
}

/** A result is only worth offering when it's actually smaller than what the person started with. */
export const isSmaller = (before: number, after: number): boolean => after > 0 && after < before;
