import { PdfError } from '@/features/tools/lib/pdf/errors';
import { pdfRunner } from '@/features/tools/pdf/pdfRunner';
import { formatBytes } from '@/lib/format';

export const MAX_FILE_BYTES = 150 * 1024 * 1024;

export type LoadedPdf = { id: string; name: string; bytes: Uint8Array; pages: number };

let counter = 0;
export const nextId = (prefix: string) => `${prefix}-${++counter}`;

/** Read PDF files. Returns the good ones and a human message for each one that couldn't be used. */
export async function readPdfs(files: File[]): Promise<{ ok: LoadedPdf[]; problems: string[] }> {
  const ok: LoadedPdf[] = [];
  const problems: string[] = [];
  for (const file of files) {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      problems.push(`${file.name}: not a PDF.`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      problems.push(`${file.name}: ${formatBytes(file.size)} is over the ${formatBytes(MAX_FILE_BYTES)} limit.`);
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // Parsing a big PDF takes a while; the worker does it so the page stays responsive.
      const { info } = await pdfRunner.run({ op: 'inspect', bytes });
      ok.push({ id: nextId('pdf'), name: file.name, bytes, pages: (info as { pages: number }).pages });
    } catch (err) {
      problems.push(`${file.name}: ${err instanceof PdfError ? err.message : 'couldn’t be read.'}`);
    }
  }
  return { ok, problems };
}

export const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

/** A download-ready Blob. (Blob construction copies the bytes, so no extra `.slice()` is needed.) */
export const pdfBlob = (bytes: Uint8Array) => new Blob([bytes as BlobPart], { type: 'application/pdf' });
