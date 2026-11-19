/**
 * The page's one PDF runner: a bundled module worker, with the engine on the main thread as the fallback.
 *
 * The `new Worker(new URL(…, import.meta.url), { type: 'module' })` form is what Vite recognises and bundles into a
 * separate, same-origin file — allowed by Manifest V3's default extension-page CSP (`script-src 'self'`), the same way
 * pdf.js's own worker is. Under `wxt dev` the URL points at the dev server (another origin), the constructor throws,
 * and the fallback takes over; the production build uses the worker.
 */
import { PdfRunner, type WorkerLike } from '@/features/tools/pdf/client';

export const pdfRunner = new PdfRunner({
  createWorker: () => new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
  fallback: async (job, ctx) => (await import('@/features/tools/lib/pdf/engine')).runJob(job, ctx),
});
