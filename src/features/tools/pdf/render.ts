/**
 * Showing PDF pages (pdf.js). Rendering is the only thing pdf.js does here; every edit is done by pdf-lib on the
 * original bytes, so what you download is never a re-rasterised copy.
 *
 * The *legacy* build keeps Chrome 116 working (the modern one needs newer JS features).
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

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

/** Draw page `index` into `canvas` so it is `cssWidth` wide (and sharp on high-DPI screens). Resolves with the CSS height. */
export function renderPage(doc: PdfDoc, index: number, canvas: HTMLCanvasElement, cssWidth: number): Promise<number> {
  return slot(async () => {
    const page = await doc.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return viewport.height / dpr;
  });
}
