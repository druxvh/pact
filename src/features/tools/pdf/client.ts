/**
 * Runs PDF jobs in a Web Worker, one at a time, and makes Cancel real.
 *
 * - **Cancel = terminate.** pdf-lib has no way to stop mid-save, so the only honest cancel is killing the worker; the
 *   next job simply starts a fresh one (a few ms). A job still waiting in the queue is just dropped.
 * - **Idle worker is released** after `idleMs`, so the memory a big merge grew isn't held for the rest of the session.
 * - **Fallback.** If a worker can't start — `new Worker` throws (the dev server serves scripts from another origin, which
 *   extension pages may not use for workers) or its script fails to load before saying `ready` — jobs run on the main
 *   thread through the same engine, yielding between steps so the page stays usable. That choice is remembered.
 *
 * The browser pieces are injected (`createWorker`, `fallback`) so all of this is tested with a loopback fake worker.
 */
import { PdfError } from '../lib/pdf/errors';
import { type JobContext, type Progress, throttleReport } from '../lib/pdf/job';
import type { JobOutput, JobSpec, WorkerRequest, WorkerResponse } from '../lib/pdf/protocol';

/** The slice of `Worker` the client uses. */
export type WorkerLike = {
  postMessage(message: WorkerRequest): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessageerror?: ((event: unknown) => void) | null;
};

export type RunnerOptions = {
  /** Start a worker. May throw (e.g. a `SecurityError`). */
  createWorker: () => WorkerLike;
  /** Run a job on the main thread instead. */
  fallback: (job: JobSpec, ctx: JobContext) => Promise<JobOutput>;
  /** Release an idle worker after this long (ms). */
  idleMs?: number;
};

export type RunOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: Progress) => void;
};

/** What `run` rejects with when the job was canceled. */
export class AbortedError extends Error {
  constructor() {
    super('Canceled');
    this.name = 'AbortError';
  }
}

export const isAbortError = (err: unknown): boolean => err instanceof Error && err.name === 'AbortError';

type Item = {
  id: number;
  job: JobSpec;
  opts: RunOptions;
  resolve: (out: JobOutput) => void;
  reject: (err: unknown) => void;
  /** Set once the person canceled; the main-thread fallback polls it. */
  aborted: boolean;
  detach: () => void;
};

type Active = { item: Item; mode: 'worker' | 'fallback' };

const DEFAULT_IDLE_MS = 30_000;

export class PdfRunner {
  private worker: WorkerLike | null = null;
  private ready = false;
  /** Creating or starting a worker failed: stay on the main thread. */
  private unavailable = false;
  private readonly queue: Item[] = [];
  private active: Active | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private nextId = 1;

  constructor(private readonly options: RunnerOptions) {}

  /** True while jobs are being run on the main thread because no worker could be started. */
  get usingFallback(): boolean {
    return this.unavailable;
  }

  run(job: JobSpec, opts: RunOptions = {}): Promise<JobOutput> {
    return new Promise<JobOutput>((resolve, reject) => {
      if (opts.signal?.aborted) return reject(new AbortedError());
      const item: Item = { id: this.nextId++, job, opts, resolve, reject, aborted: false, detach: () => {} };
      if (opts.signal) {
        const onAbort = () => this.abort(item);
        opts.signal.addEventListener('abort', onAbort, { once: true });
        item.detach = () => opts.signal?.removeEventListener('abort', onAbort);
      }
      this.queue.push(item);
      this.pump();
    });
  }

  // --- queue ---------------------------------------------------------------------------------------------------

  private pump(): void {
    if (this.active) return;
    const item = this.queue.shift();
    if (!item) return;
    clearTimeout(this.idleTimer);
    this.start(item);
  }

  private start(item: Item): void {
    const worker = this.unavailable ? null : this.ensureWorker();
    if (!worker) return void this.runOnMainThread(item);
    this.active = { item, mode: 'worker' };
    worker.postMessage({ type: 'run', id: item.id, job: item.job });
  }

  private finish(item: Item, settle: () => void): void {
    item.detach();
    if (this.active?.item === item) this.active = null;
    settle();
    if (!this.active && this.queue.length === 0 && this.worker) {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this.killWorker(), this.options.idleMs ?? DEFAULT_IDLE_MS);
    }
    this.pump();
  }

  private abort(item: Item): void {
    item.aborted = true;
    const queued = this.queue.indexOf(item);
    if (queued >= 0) {
      this.queue.splice(queued, 1);
      item.detach();
      item.reject(new AbortedError());
      return;
    }
    if (this.active?.item !== item) return;
    if (this.active.mode === 'worker') {
      this.killWorker(); // the real cancel: pdf-lib can't be interrupted, a terminated worker can
      this.finish(item, () => item.reject(new AbortedError()));
    } else {
      // On the main thread the engine stops at its next checkpoint; reject now so the UI reacts instantly. The queue
      // moves on when the engine actually returns (see runOnMainThread).
      item.detach();
      item.reject(new AbortedError());
    }
  }

  // --- worker --------------------------------------------------------------------------------------------------

  private ensureWorker(): WorkerLike | null {
    if (this.worker) return this.worker;
    let worker: WorkerLike;
    try {
      worker = this.options.createWorker();
    } catch {
      this.unavailable = true;
      return null;
    }
    this.ready = false;
    worker.onmessage = (event) => this.onMessage(worker, event.data);
    worker.onerror = () => this.onWorkerFailure(worker);
    worker.onmessageerror = () => this.onWorkerFailure(worker);
    this.worker = worker;
    return worker;
  }

  private killWorker(): void {
    clearTimeout(this.idleTimer);
    const worker = this.worker;
    this.worker = null;
    this.ready = false;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
  }

  private onMessage(from: WorkerLike, message: WorkerResponse): void {
    if (from !== this.worker) return; // a worker we already terminated
    if (message.type === 'ready') {
      this.ready = true;
      return;
    }
    const active = this.active;
    if (active?.mode !== 'worker' || active.item.id !== message.id) return;
    const { item } = active;
    switch (message.type) {
      case 'progress':
        item.opts.onProgress?.(message.progress);
        break;
      case 'result':
        this.finish(item, () => item.resolve({ files: message.files.map((b) => new Uint8Array(b)), info: message.info }));
        break;
      case 'error':
        this.finish(item, () => item.reject(message.kind === 'pdf' ? new PdfError(message.message) : new Error(message.message)));
        break;
      case 'cancelled':
        this.finish(item, () => item.reject(new AbortedError()));
        break;
    }
  }

  private onWorkerFailure(from: WorkerLike): void {
    if (from !== this.worker) return;
    const wasReady = this.ready;
    const active = this.active;
    this.killWorker();
    if (!wasReady) {
      // The script never started: use the main thread from now on and redo the job that was waiting on it.
      this.unavailable = true;
      if (active?.mode === 'worker') {
        this.active = null;
        this.runOnMainThread(active.item);
      }
      return;
    }
    if (active?.mode === 'worker') {
      this.finish(active.item, () => active.item.reject(new Error('The PDF engine stopped unexpectedly (the file may be too large for this device).')));
    }
  }

  // --- main thread ---------------------------------------------------------------------------------------------

  private async runOnMainThread(item: Item): Promise<void> {
    this.active = { item, mode: 'fallback' };
    const ctx: JobContext = {
      isCancelled: () => item.aborted,
      report: throttleReport((p) => item.opts.onProgress?.(p)),
    };
    try {
      const out = await this.options.fallback(item.job, ctx);
      item.resolve(out);
    } catch (err) {
      item.reject(err);
    } finally {
      item.detach();
      if (this.active?.item === item) this.active = null;
      this.pump();
    }
  }
}
