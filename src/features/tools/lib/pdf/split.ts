/** Split one PDF into several by page range. Each output is its own file; resources shared by its pages are copied once per file. */
import { PDFDocument } from 'pdf-lib';
import { PageCopier } from './copy';
import { PdfError } from './errors';
import { checkpoint, type JobContext } from './job';
import { loadPdf, SAVE_OPTIONS } from './ops';
import type { PageRange } from './ranges';

export async function splitPdf(bytes: Uint8Array, ranges: readonly PageRange[], ctx?: JobContext): Promise<Uint8Array[]> {
  if (ranges.length === 0) throw new PdfError('Choose at least one range to split off.');
  await checkpoint(ctx, 0, ranges.length + 1, 'Reading the PDF');
  const src = await loadPdf(bytes);
  const total = src.getPageCount();
  for (const r of ranges) {
    if (!Number.isInteger(r.from) || !Number.isInteger(r.to) || r.from < 1 || r.to < r.from || r.to > total) {
      throw new PdfError(`Pages ${r.from}–${r.to} don’t exist — this PDF has ${total} ${total === 1 ? 'page' : 'pages'}.`);
    }
  }

  const outputs: Uint8Array[] = [];
  for (const [n, r] of ranges.entries()) {
    await checkpoint(ctx, n + 1, ranges.length + 1, `Writing file ${n + 1} of ${ranges.length}`);
    const out = await PDFDocument.create();
    const copier = new PageCopier(src, out);
    for (let p = r.from - 1; p < r.to; p++) out.addPage(copier.copy(p));
    outputs.push(await out.save(SAVE_OPTIONS));
  }
  return outputs;
}
