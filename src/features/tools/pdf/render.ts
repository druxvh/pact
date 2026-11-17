/**
 * Showing PDF pages (pdf.js). Rendering is the only thing pdf.js does here; every edit is done by pdf-lib on the
 * original bytes, so what you download is never a re-rasterised copy — with one deliberate exception: Compress →
 * Balanced / Small, which draws pages to JPEGs (`rasterizePage`) and says so.
 *
 * The *legacy* build keeps Chrome 116 working (the modern one needs newer JS features).
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { type RasterSettings, renderScale } from '@/features/tools/lib/pdf/rasterPlan';
import type { RasterPage } from '@/features/tools/lib/pdf/types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfDoc = pdfjs.PDFDocumentProxy;

/** pdf.js takes ownership of the buffer it's given, so hand it a copy and keep ours for pdf-lib. */
export async function openPdf(bytes: Uint8Array): Promise<PdfDoc> {
  return pdfjs.getDocument({ data: bytes.slice() }).promise;
}

/** Release a document's worker memory. */
export const closePdf = (doc: PdfDoc): Promise<void> => doc.loadingTask.destroy();

// A tiny queue: rendering 60 thumbnails at once would stall the page, so do a few at a time.
let running = 0;
const waiting: Array<() => void> = [];
const MAX_PARALLEL = 3;
async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Page size as displayed at scale 1 (its own /Rotate already applied), in CSS px. */
export async function pageSize(doc: PdfDoc, index: number): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(index + 1);
  const v = page.getViewport({ scale: 1 });
  return { width: v.width, height: v.height };
}

/**
 * Draw page `index` into `canvas` so it is `cssWidth` wide (and sharp on high-DPI screens). Resolves with the CSS height.
 * Aborting `signal` stops the drawing (a thumbnail that scrolled away or a preview that was replaced shouldn't keep a
 * page rendering) and the page's cached resources are released afterwards, so a long document doesn't pile up in memory.
 */
export function renderPage(doc: PdfDoc, index: number, canvas: HTMLCanvasElement, cssWidth: number, signal?: AbortSignal): Promise<number> {
  return slot(async () => {
    if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
    const page = await doc.getPage(index + 1);
    try {
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const task = page.render({ canvas, viewport });
      const stop = () => task.cancel();
      signal?.addEventListener('abort', stop, { once: true });
      try {
        await task.promise;
      } finally {
        signal?.removeEventListener('abort', stop);
      }
      return viewport.height / dpr;
    } finally {
      page.cleanup();
    }
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t encode a page.'))), type, quality));
}

/**
 * Draw one page to a JPEG for Compress → Balanced / Small. White background (JPEG has no transparency); the canvas is
 * released right away so a 300-page file never holds more than one page of pixels. `width`/`height` are the page's size in
 * PDF points as displayed (its own rotation applied), which is what the rebuilt page gets.
 */
export async function rasterizePage(doc: PdfDoc, index: number, settings: RasterSettings, signal?: AbortSignal): Promise<RasterPage> {
  if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
  const page = await doc.getPage(index + 1);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: renderScale(base.width, base.height, settings.dpi) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    try {
      const task = page.render({ canvas, viewport, background: '#ffffff' });
      const stop = () => task.cancel();
      signal?.addEventListener('abort', stop, { once: true });
      try {
        await task.promise;
      } finally {
        signal?.removeEventListener('abort', stop);
      }
      const blob = await toBlob(canvas, 'image/jpeg', Math.min(1, Math.max(0.1, settings.quality)));
      return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: base.width, height: base.height };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    page.cleanup();
  }
}
