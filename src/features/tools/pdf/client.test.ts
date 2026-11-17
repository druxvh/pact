// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CancelledError, PdfError } from '../lib/pdf/errors';
import type { JobContext } from '../lib/pdf/job';
import type { JobOutput, JobSpec, WorkerRequest, WorkerResponse } from '../lib/pdf/protocol';
import { createWorkerHandler } from '../lib/pdf/workerHandler';
import { AbortedError, isAbortError, PdfRunner, type WorkerLike } from './client';

type Run = (job: JobSpec, ctx: JobContext) => Promise<JobOutput>;

/** A worker that lives in this thread: it speaks the real protocol through the real handler, so the client is tested end to end. */
class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  terminated = false;
  received: WorkerRequest[] = [];
  private readonly handle: (r: WorkerRequest) => Promise<void>;

  constructor(
    run: Run,
    private readonly mode: 'ok' | 'never-loads' = 'ok',
  ) {
    this.handle = createWorkerHandler((message, transfer) => this.deliver(message, transfer), run);
    if (mode === 'ok') queueMicrotask(() => this.deliver({ type: 'ready' }));
    else setTimeout(() => this.onerror?.({ message: 'Failed to load worker script' }), 0);
  }
  postMessage(request: WorkerRequest): void {
    if (this.terminated || this.mode !== 'ok') return;
    this.received.push(request);
    void this.handle(request);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** What a real worker would do on an uncaught error. */
  crash(): void {
    this.onerror?.({ message: 'boom' });
  }
  deliver(message: WorkerResponse, transfer?: Transferable[]): void {
    // Real postMessage with a transfer list moves buffers; clone to be sure nothing is shared by accident.
    const data = structuredClone(message, { transfer });
    queueMicrotask(() => !this.terminated && this.onmessage?.({ data }));
  }
}

const bytes = (...n: number[]) => new Uint8Array(n);
const job = (tag = 0): JobSpec => ({ op: 'merge', files: [bytes(tag)] });
const echo: Run = async (j) => ({ files: [bytes(j.op === 'merge' ? (j.files[0]?.[0] ?? 0) : 0)] });

/** A run you can finish (or fail) by hand. */
function manual() {
  const waiting: Array<{ job: JobSpec; ctx: JobContext; done: (out: JobOutput) => void; fail: (e: unknown) => void }> = [];
  const run: Run = (j, ctx) => new Promise((done, fail) => waiting.push({ job: j, ctx, done, fail }));
  return { run, waiting };
}

function setup(run: Run = echo, extra: Partial<ConstructorParameters<typeof PdfRunner>[0]> = {}) {
  const workers: FakeWorker[] = [];
  const fallback = vi.fn<Run>(async () => ({ files: [bytes(42)] }));
  const runner = new PdfRunner({
    createWorker: () => {
      const w = new FakeWorker(run);
      workers.push(w);
      return w;
    },
    fallback,
    idleMs: 1000,
    ...extra,
  });
  return { runner, workers, fallback };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('PdfRunner with a worker', () => {
  it('runs a job and hands back the files as Uint8Arrays (and info)', async () => {
    const { runner, workers } = setup(async () => ({ files: [bytes(1, 2, 3), bytes(4)], info: { pages: 9 } }));
    const out = await runner.run(job());
    expect(out.files.map((f) => Array.from(f))).toEqual([[1, 2, 3], [4]]);
    expect(out.files[0]).toBeInstanceOf(Uint8Array);
    expect(out.info).toEqual({ pages: 9 });
    expect(workers).toHaveLength(1);
    expect(workers[0]?.received[0]).toMatchObject({ type: 'run', job: { op: 'merge' } });
    expect(runner.usingFallback).toBe(false);
  });

  it('forwards progress', async () => {
    const { runner } = setup(async (_j, ctx) => {
      ctx.report?.({ done: 1, total: 4, label: 'Copying page 1 of 4' });
      return { files: [bytes(1)] };
    });
    const seen: string[] = [];
    await runner.run(job(), { onProgress: (p) => seen.push(`${p.done}/${p.total} ${p.label}`) });
    expect(seen).toEqual(['1/4 Copying page 1 of 4']);
  });

  it('reuses one worker for many jobs and runs them one at a time, in order', async () => {
    const { run, waiting } = manual();
    const { runner, workers } = setup(run);
    const first = runner.run(job(1));
    const second = runner.run(job(2));
    await flush();
    expect(waiting).toHaveLength(1); // the second waits for the first
    waiting[0]?.done({ files: [bytes(1)] });
    expect((await first).files[0]?.[0]).toBe(1);
    await flush();
    expect(waiting).toHaveLength(2);
    waiting[1]?.done({ files: [bytes(2)] });
    expect((await second).files[0]?.[0]).toBe(2);
    expect(workers).toHaveLength(1);
  });

  it('maps worker errors: PdfError to show as is, anything else to a plain Error', async () => {
    const { runner } = setup(async (j) => {
      if (j.op === 'merge' && j.files[0]?.[0] === 1) throw new PdfError('This PDF is password-protected.');
      throw new TypeError('kaboom');
    });
    const first = await runner.run(job(1)).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(PdfError);
    expect((first as Error).message).toBe('This PDF is password-protected.');
    const second = await runner.run(job(2)).catch((e: unknown) => e);
    expect(second).not.toBeInstanceOf(PdfError);
    expect((second as Error).message).toBe('kaboom');
  });

  describe('cancel', () => {
    it('terminates the worker, rejects with an abort, and the next job gets a fresh worker', async () => {
      const { run, waiting } = manual();
      const { runner, workers } = setup(run);
      const ac = new AbortController();
      const running = runner.run(job(1), { signal: ac.signal });
      await flush();
      expect(waiting).toHaveLength(1);
      ac.abort();
      const err = await running.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AbortedError);
      expect(isAbortError(err)).toBe(true);
      expect(workers[0]?.terminated).toBe(true);

      const next = runner.run(job(2));
      await flush();
      expect(workers).toHaveLength(2); // recreated
      expect(workers[1]?.terminated).toBe(false);
      waiting[1]?.done({ files: [bytes(2)] });
      expect((await next).files[0]?.[0]).toBe(2);
    });

    it('ignores what a terminated worker still says', async () => {
      const { run, waiting } = manual();
      const { runner } = setup(run);
      const ac = new AbortController();
      const first = runner.run(job(1), { signal: ac.signal });
      await flush();
      ac.abort();
      await first.catch(() => {});
      const second = runner.run(job(2));
      await flush();
      waiting[0]?.done({ files: [bytes(99)] }); // the dead worker's late answer
      await flush();
      waiting[1]?.done({ files: [bytes(2)] });
      expect((await second).files[0]?.[0]).toBe(2);
    });

    it('drops a job that is still waiting without touching the running one', async () => {
      const { run, waiting } = manual();
      const { runner, workers } = setup(run);
      const ac = new AbortController();
      const first = runner.run(job(1));
      const queued = runner.run(job(2), { signal: ac.signal });
      await flush();
      ac.abort();
      await expect(queued).rejects.toBeInstanceOf(AbortedError);
      expect(workers[0]?.terminated).toBe(false);
      waiting[0]?.done({ files: [bytes(1)] });
      expect((await first).files[0]?.[0]).toBe(1);
      expect(workers[0]?.received).toHaveLength(1); // the canceled job never reached the worker
    });

    it('rejects at once when the signal is already aborted, without starting a worker', async () => {
      const { runner, workers } = setup();
      const ac = new AbortController();
      ac.abort();
      await expect(runner.run(job(), { signal: ac.signal })).rejects.toBeInstanceOf(AbortedError);
      expect(workers).toHaveLength(0);
    });

    it('a worker that says "cancelled" is also an abort', async () => {
      const { runner } = setup(async () => {
        throw new CancelledError();
      });
      await expect(runner.run(job())).rejects.toSatisfy(isAbortError);
    });
  });

  describe('a worker that dies', () => {
    it('after it was running fine: that job fails with a clear message and the next one gets a new worker', async () => {
      const { run, waiting } = manual();
      const { runner, workers } = setup(run);
      const first = runner.run(job(1));
      await flush();
      workers[0]?.crash();
      await expect(first).rejects.toThrow('stopped unexpectedly');
      expect(workers[0]?.terminated).toBe(true);
      expect(runner.usingFallback).toBe(false);
      const next = runner.run(job(2));
      await flush();
      expect(workers).toHaveLength(2);
      waiting[1]?.done({ files: [bytes(2)] });
      await next;
    });
  });

  describe('idle worker', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('is released after idleMs, and recreated on demand', async () => {
      const { runner, workers } = setup();
      const done = runner.run(job(1));
      await vi.advanceTimersByTimeAsync(0);
      await done;
      expect(workers[0]?.terminated).toBe(false);
      await vi.advanceTimersByTimeAsync(999);
      expect(workers[0]?.terminated).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(workers[0]?.terminated).toBe(true);
      const again = runner.run(job(2));
      await vi.advanceTimersByTimeAsync(0);
      await again;
      expect(workers).toHaveLength(2);
    });

    it('is kept while jobs keep coming', async () => {
      const { runner, workers } = setup();
      for (let i = 0; i < 3; i++) {
        const p = runner.run(job(i));
        await vi.advanceTimersByTimeAsync(0);
        await p;
        await vi.advanceTimersByTimeAsync(700);
      }
      expect(workers).toHaveLength(1);
      expect(workers[0]?.terminated).toBe(false);
    });
  });
});

describe('PdfRunner fallback (no worker available)', () => {
  it('runs on the main thread when a worker cannot be created, and remembers', async () => {
    const createWorker = vi.fn(() => {
      throw new DOMException('Failed to construct Worker', 'SecurityError');
    });
    const fallback = vi.fn<Run>(async () => ({ files: [bytes(7)] }));
    const runner = new PdfRunner({ createWorker, fallback });
    expect((await runner.run(job())).files[0]?.[0]).toBe(7);
    expect((await runner.run(job())).files[0]?.[0]).toBe(7);
    expect(createWorker).toHaveBeenCalledTimes(1); // not retried for every job
    expect(fallback).toHaveBeenCalledTimes(2);
    expect(runner.usingFallback).toBe(true);
  });

  it('redoes the job on the main thread when the worker script fails to load', async () => {
    const workers: FakeWorker[] = [];
    const fallback = vi.fn<Run>(async () => ({ files: [bytes(9)] }));
    const runner = new PdfRunner({
      createWorker: () => {
        const w = new FakeWorker(echo, 'never-loads');
        workers.push(w);
        return w;
      },
      fallback,
    });
    const onProgress = vi.fn();
    const out = await runner.run(job(1), { onProgress });
    expect(out.files[0]?.[0]).toBe(9);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(workers[0]?.terminated).toBe(true);
    expect(runner.usingFallback).toBe(true);
    await runner.run(job(2));
    expect(workers).toHaveLength(1); // no more tries
  });

  it('passes progress through and stops at the next step when canceled', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let observed: JobContext | undefined;
    const fallback: Run = async (_j, ctx) => {
      observed = ctx;
      ctx.report?.({ done: 1, total: 2, label: 'Working' });
      await gate;
      if (ctx.isCancelled?.()) throw new CancelledError();
      return { files: [bytes(1)] };
    };
    const runner = new PdfRunner({
      createWorker: () => {
        throw new Error('no workers here');
      },
      fallback,
    });
    const seen: string[] = [];
    const ac = new AbortController();
    const running = runner.run(job(1), { signal: ac.signal, onProgress: (p) => seen.push(p.label) });
    const queued = runner.run(job(2));
    await flush();
    expect(seen).toEqual(['Working']);
    expect(observed?.isCancelled?.()).toBe(false);
    ac.abort();
    expect(observed?.isCancelled?.()).toBe(true);
    await expect(running).rejects.toBeInstanceOf(AbortedError); // the page hears about it immediately…
    release();
    expect((await queued).files[0]?.[0]).toBe(1); // …and the queue moves on once the engine has actually stopped
  });

  it('a fallback error reaches the caller untouched', async () => {
    const runner = new PdfRunner({
      createWorker: () => {
        throw new Error('no');
      },
      fallback: async () => {
        throw new PdfError('Bad file');
      },
    });
    await expect(runner.run(job())).rejects.toBeInstanceOf(PdfError);
  });
});
