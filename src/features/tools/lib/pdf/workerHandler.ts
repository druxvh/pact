/**
 * The worker's side of the protocol, with the worker globals injected — so `pdf.worker.ts` is a three-line shell and
 * this logic is tested in plain Node. See `protocol.ts` for the messages.
 */
import { runJob } from './engine';
import { CancelledError, PdfError } from './errors';
import { type JobContext, throttleReport } from './job';
import { type JobOutput, type JobSpec, toTransferable, type WorkerRequest, type WorkerResponse } from './protocol';

export type Post = (message: WorkerResponse, transfer?: Transferable[]) => void;

export function createWorkerHandler(
  post: Post,
  run: (job: JobSpec, ctx: JobContext) => Promise<JobOutput> = runJob,
): (request: WorkerRequest) => Promise<void> {
  const running = new Set<number>();
  const cancelled = new Set<number>();

  return async (request) => {
    if (request.type === 'cancel') {
      // Only meaningful while the job is running; a cancel that arrives late must not poison a reused id.
      if (running.has(request.id)) cancelled.add(request.id);
      return;
    }

    const { id, job } = request;
    running.add(id);
    const ctx: JobContext = {
      isCancelled: () => cancelled.has(id),
      report: throttleReport((progress) => post({ type: 'progress', id, progress })),
    };
    try {
      const out = await run(job, ctx);
      if (cancelled.has(id)) {
        post({ type: 'cancelled', id });
        return;
      }
      const files = out.files.map(toTransferable);
      post({ type: 'result', id, files, info: out.info }, files);
    } catch (err) {
      if (err instanceof CancelledError || cancelled.has(id)) post({ type: 'cancelled', id });
      else if (err instanceof PdfError) post({ type: 'error', id, kind: 'pdf', message: err.message });
      else post({ type: 'error', id, kind: 'unexpected', message: err instanceof Error ? err.message : String(err) });
    } finally {
      running.delete(id);
      cancelled.delete(id);
    }
  };
}
