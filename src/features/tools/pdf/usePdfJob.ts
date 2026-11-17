import { useCallback, useEffect, useRef, useState } from 'react';
import { inBand, type Progress } from '@/features/tools/lib/pdf/job';
import type { JobOutput, JobSpec } from '@/features/tools/lib/pdf/protocol';
import { AbortedError, isAbortError } from '@/features/tools/pdf/client';
import { pdfRunner } from '@/features/tools/pdf/pdfRunner';
import { notify } from '@/lib/toast';

/** What the work inside `run(...)` can use. */
export type JobApi = {
  /** Run a job in the PDF worker. `band` squeezes its progress into a slice of the overall 0–1 bar (e.g. `[0.8, 1]`). */
  run: (job: JobSpec, band?: [number, number]) => Promise<JobOutput>;
  /** Report progress for work done on the main thread (drawing pages, re-encoding images…). Throws if canceled. */
  step: (progress: Progress) => void;
  /** Aborted when the person presses Cancel (pass it to anything cancelable, e.g. `rasterizePage`). */
  readonly signal: AbortSignal;
  /** True once the person pressed Cancel. */
  readonly canceled: boolean;
  /** Throws if canceled — call between main-thread steps. */
  check: () => void;
};

const STARTING: Progress = { done: 0, total: 0, label: 'Starting…' };

/**
 * One PDF job at a time for a tool: progress to show, a real Cancel, and the same error/cancel toasts everywhere.
 * Leaving the tool cancels whatever is running (the worker is terminated, so nothing keeps working in the background).
 */
export function usePdfJob() {
  const [state, setState] = useState<{ busy: boolean; progress: Progress | null }>({ busy: false, progress: null });
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);

  const run = useCallback(async <T>(work: (api: JobApi) => Promise<T>, failTitle: string): Promise<T | undefined> => {
    if (controller.current) return undefined;
    const ac = new AbortController();
    controller.current = ac;
    const show = (progress: Progress) => alive.current && setState({ busy: true, progress });
    show(STARTING);

    const api: JobApi = {
      run: (job, band) => pdfRunner.run(job, { signal: ac.signal, onProgress: (p) => show(band ? inBand(p, band[0], band[1]) : p) }),
      step: (progress) => {
        if (ac.signal.aborted) throw new AbortedError();
        show(progress);
      },
      signal: ac.signal,
      get canceled() {
        return ac.signal.aborted;
      },
      check: () => {
        if (ac.signal.aborted) throw new AbortedError();
      },
    };

    try {
      return await work(api);
    } catch (err) {
      if (!alive.current) return undefined; // the person already left the tool; no toast about work they walked away from
      // pdf.js reports a canceled render with its own exception, not an AbortError: if the person pressed Cancel, that's what this is.
      if (isAbortError(err) || ac.signal.aborted) notify.info('Canceled', 'Nothing was saved.');
      else notify.error(failTitle, err instanceof Error ? err.message : undefined);
      return undefined;
    } finally {
      controller.current = null;
      if (alive.current) setState({ busy: false, progress: null });
    }
  }, []);

  const cancel = useCallback(() => controller.current?.abort(), []);

  return { busy: state.busy, progress: state.progress, run, cancel };
}

export type PdfJob = ReturnType<typeof usePdfJob>;
