/**
 * Plain data shared by the PDF operations, the worker protocol and the tools' UI. No imports from pdf-lib or the DOM, so
 * the main thread can use these without pulling the PDF engine into its bundle.
 */
import type { FRect } from './geometry';

/** One output page: which source file, which of its pages (0-based), and how much to turn it on top of its own rotation. */
export type PageRef = { source: number; page: number; rotate: number };

export type ImageInput = { bytes: Uint8Array; kind: 'jpg' | 'png' };
export type ImagePageSize = 'fit' | 'a4' | 'letter';
export type ImagesToPdfOptions = { size: ImagePageSize /** points */; margin: number; orientation: 'auto' | 'portrait' | 'landscape' };

export type SignaturePlacement = { page: number; rect: FRect; png: Uint8Array };

/** A page already drawn to a JPEG (Compress → Balanced / Small). `width` and `height` are the page's size in PDF points. */
export type RasterPage = { jpeg: Uint8Array; width: number; height: number };

export type WatermarkPosition = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';

export type WatermarkOptions = {
  text: string;
  /** Font size in points. */
  size: number;
  bold: boolean;
  /** `#rrggbb` */
  color: string;
  /** 0–1 */
  opacity: number;
  /** Degrees, counter-clockwise, as the viewer sees the page. */
  rotation: number;
  layout: 'single' | 'tiled';
  position: WatermarkPosition;
  /** 0-based pages to stamp; `null` = every page. */
  pages: number[] | null;
};
