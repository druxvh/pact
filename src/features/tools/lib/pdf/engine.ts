/**
 * The PDF engine: one function that runs any job. It is what the worker calls — and what the page calls itself when a
 * worker can't be started — so there is exactly one implementation. It must stay free of DOM APIs (it runs in a worker).
 */
import { optimizePdf, rebuildFromJpegs } from './compress';
import type { JobContext } from './job';
import { assemble, cropPdf, imagesToPdf, mergePdfs, pageCount, signPdf } from './ops';
import type { JobOutput, JobSpec } from './protocol';
import { splitPdf } from './split';
import { measureFonts, watermarkPdf } from './watermark';

export type { JobContext } from './job';

const one = async (out: Promise<Uint8Array>): Promise<JobOutput> => ({ files: [await out] });

/** Run a job to completion. Rejects with `PdfError` for things a person can fix and with `CancelledError` if canceled. */
export async function runJob(job: JobSpec, ctx?: JobContext): Promise<JobOutput> {
  switch (job.op) {
    case 'inspect':
      return { files: [], info: { pages: await pageCount(job.bytes) } };
    case 'merge':
      return one(mergePdfs(job.files, ctx));
    case 'assemble':
      return one(assemble(job.sources, job.pages, ctx));
    case 'split':
      return { files: await splitPdf(job.bytes, job.ranges, ctx) };
    case 'crop':
      return one(cropPdf(job.bytes, job.crops, ctx));
    case 'sign':
      return one(signPdf(job.bytes, job.placements, ctx));
    case 'images':
      return one(imagesToPdf(job.images, job.options, ctx));
    case 'optimize':
      return one(optimizePdf(job.bytes, ctx));
    case 'rebuild':
      return one(rebuildFromJpegs(job.pages, ctx));
    case 'watermark':
      return one(watermarkPdf(job.bytes, job.options, ctx));
    case 'fontMetrics':
      return { files: [], info: await measureFonts() };
  }
}
