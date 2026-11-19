// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { runJob } from './engine';
import { CancelledError, PdfError } from './errors';
import { JPEG, makePdf, PNG } from './fixtures';
import { checkpoint, fraction, inBand, type JobContext, type Progress, throttleReport } from './job';
import { type JobOutput, type JobSpec, toTransferable, type WorkerResponse } from './protocol';
import { createWorkerHandler } from './workerHandler';

const pageCountOf = async (bytes: Uint8Array | undefined) => (await PDFDocument.load(bytes as Uint8Array)).getPageCount();

/** Run a job and keep every progress report. */
async function withProgress(job: JobSpec) {
  const reports: Progress[] = [];
  const out = await runJob(job, { report: (p) => reports.push(p), yieldNow: async () => {} });
  return { out, reports };
}

describe('runJob', () => {
  it('answers every operation', async () => {
    const [a, b] = [await makePdf(3), await makePdf(2)];
    expect((await runJob({ op: 'inspect', bytes: a })).info).toEqual({ pages: 3 });
    expect(await pageCountOf((await runJob({ op: 'merge', files: [a, b] })).files[0])).toBe(5);
    expect(await pageCountOf((await runJob({ op: 'assemble', sources: [a, b], pages: [{ source: 1, page: 0, rotate: 90 }] })).files[0])).toBe(1);
    const split = await runJob({
      op: 'split',
      bytes: a,
      ranges: [
        { from: 1, to: 2 },
        { from: 3, to: 3 },
      ],
    });
    expect(await Promise.all(split.files.map(pageCountOf))).toEqual([2, 1]);
    expect(await pageCountOf((await runJob({ op: 'crop', bytes: a, crops: [{ left: 0, top: 0, width: 0.5, height: 0.5 }, null, null] })).files[0])).toBe(3);
    expect(
      await pageCountOf(
        (await runJob({ op: 'sign', bytes: a, placements: [{ page: 0, rect: { left: 0.1, top: 0.1, width: 0.3, height: 0.1 }, png: PNG }] })).files[0],
      ),
    ).toBe(3);
    expect(
      await pageCountOf(
        (await runJob({ op: 'images', images: [{ bytes: PNG, kind: 'png' }], options: { size: 'a4', margin: 0, orientation: 'auto' } })).files[0],
      ),
    ).toBe(1);
    expect(await pageCountOf((await runJob({ op: 'optimize', bytes: a })).files[0])).toBe(3);
    expect(await pageCountOf((await runJob({ op: 'rebuild', pages: [{ jpeg: JPEG, width: 100, height: 100 }] })).files[0])).toBe(1);
    const wm = await runJob({
      op: 'watermark',
      bytes: a,
      options: { text: 'X', size: 30, bold: false, color: '#000000', opacity: 0.5, rotation: 0, layout: 'single', position: 'center', pages: null },
    });
    expect(await pageCountOf(wm.files[0])).toBe(3);
    expect((await runJob({ op: 'fontMetrics' })).info).toMatchObject({ regular: { A: expect.any(Number) } });
  });

  it('reports steady progress that ends at "Saving"', async () => {
    const files = await Promise.all([makePdf(2), makePdf(2), makePdf(2)]);
    for (const job of [
      { op: 'merge', files } as const,
      { op: 'assemble', sources: files, pages: [0, 1, 2].map((s) => ({ source: s, page: 0, rotate: 0 })) } as const,
    ]) {
      const { reports } = await withProgress(job);
      expect(reports.length).toBeGreaterThan(2);
      for (const r of reports) {
        expect(r.done).toBeLessThanOrEqual(r.total);
        expect(r.total).toBeGreaterThan(0);
        expect(r.label.length).toBeGreaterThan(0);
      }
      const dones = reports.map((r) => r.done);
      expect([...dones].sort((x, y) => x - y)).toEqual(dones); // never goes backwards
      expect(reports.at(-1)?.label).toBe('Saving');
    }
  });

  it('stops at the next step when canceled (merge, assemble, split, watermark, sign, crop, images)', async () => {
    const pdf = await makePdf(6);
    const jobs: JobSpec[] = [
      { op: 'merge', files: [pdf, pdf, pdf] },
      { op: 'assemble', sources: [pdf], pages: Array.from({ length: 6 }, (_, page) => ({ source: 0, page, rotate: 0 })) },
      { op: 'split', bytes: pdf, ranges: [1, 2, 3, 4].map((n) => ({ from: n, to: n })) },
      {
        op: 'watermark',
        bytes: pdf,
        options: { text: 'X', size: 20, bold: false, color: '#000', opacity: 1, rotation: 0, layout: 'single', position: 'center', pages: null },
      },
      { op: 'sign', bytes: pdf, placements: [0, 1, 2].map((page) => ({ page, rect: { left: 0, top: 0, width: 0.2, height: 0.1 }, png: PNG })) },
      { op: 'images', images: [1, 2, 3].map(() => ({ bytes: PNG, kind: 'png' as const })), options: { size: 'a4', margin: 0, orientation: 'auto' } },
    ];
    for (const job of jobs) {
      let steps = 0;
      const ctx: JobContext = { report: () => steps++, isCancelled: () => steps >= 2, yieldNow: async () => {} };
      await expect(runJob(job, ctx), job.op).rejects.toBeInstanceOf(CancelledError);
      expect(steps, job.op).toBeLessThan(8); // it stopped early instead of finishing the work
    }
  });

  it('rejects with PdfError for problems a person can fix', async () => {
    await expect(runJob({ op: 'inspect', bytes: new Uint8Array([1, 2, 3]) })).rejects.toBeInstanceOf(PdfError);
    await expect(runJob({ op: 'split', bytes: await makePdf(2), ranges: [{ from: 1, to: 9 }] })).rejects.toThrow('don’t exist');
    await expect(runJob({ op: 'split', bytes: await makePdf(2), ranges: [] })).rejects.toBeInstanceOf(PdfError);
  });
});

describe('job helpers', () => {
  it('checkpoint is a no-op without a context and honours cancel with one', async () => {
    await expect(checkpoint(undefined, 0, 1, 'x')).resolves.toBeUndefined();
    await expect(checkpoint({ isCancelled: () => true }, 0, 1, 'x')).rejects.toBeInstanceOf(CancelledError);
  });
  it('yields to the event loop when a job has been running a while', async () => {
    let yields = 0;
    const ctx: JobContext = {
      yieldNow: async () => {
        yields++;
      },
    };
    await checkpoint(ctx, 0, 1, 'x'); // first call: long since the last yield
    const until = performance.now() + 30;
    while (performance.now() < until);
    await checkpoint(ctx, 0, 1, 'x');
    expect(yields).toBeGreaterThanOrEqual(1);
  });
  it('turns progress into fractions and slices of a bigger bar', () => {
    expect(fraction({ done: 1, total: 4, label: '' })).toBe(0.25);
    expect(fraction({ done: 9, total: 4, label: '' })).toBe(1);
    expect(fraction({ done: 1, total: 0, label: '' })).toBeNull();
    expect(inBand({ done: 1, total: 2, label: 'half' }, 0.5, 1)).toEqual({ done: 750, total: 1000, label: 'half' });
    expect(inBand({ done: 0, total: 0, label: 'unknown' }, 0.2, 0.4).done).toBe(200);
  });
  it('throttles reports but always lets the last one through', () => {
    const seen: number[] = [];
    const report = throttleReport((p) => seen.push(p.done), 10_000);
    for (let i = 0; i <= 5; i++) report({ done: i, total: 5, label: '' });
    expect(seen).toEqual([0, 5]);
  });
});

describe('worker handler (the worker’s side of the protocol)', () => {
  type Sent = { message: WorkerResponse; transfer?: Transferable[] };
  const setup = (run?: Parameters<typeof createWorkerHandler>[1]) => {
    const sent: Sent[] = [];
    const handle = createWorkerHandler((message, transfer) => sent.push({ message, transfer }), run);
    return { sent, handle };
  };

  it('answers a run with the result files as transferred buffers', async () => {
    const { sent, handle } = setup();
    await handle({ type: 'run', id: 7, job: { op: 'merge', files: [await makePdf(1), await makePdf(1)] } });
    const result = sent.find((s) => s.message.type === 'result');
    expect(result?.message).toMatchObject({ type: 'result', id: 7 });
    const message = result?.message as Extract<WorkerResponse, { type: 'result' }>;
    expect(message.files).toHaveLength(1);
    expect(message.files[0]).toBeInstanceOf(ArrayBuffer);
    expect(result?.transfer).toEqual(message.files); // moved, not copied
    expect(sent.some((s) => s.message.type === 'progress')).toBe(true);
  });

  it('turns failures into messages: PdfError is something to show, anything else is unexpected', async () => {
    const pdfFail = setup(async () => {
      throw new PdfError('Nope, that is encrypted.');
    });
    await pdfFail.handle({ type: 'run', id: 1, job: { op: 'fontMetrics' } });
    expect(pdfFail.sent.at(-1)?.message).toEqual({ type: 'error', id: 1, kind: 'pdf', message: 'Nope, that is encrypted.' });

    const crash = setup(async () => {
      throw new TypeError('x is not a function');
    });
    await crash.handle({ type: 'run', id: 2, job: { op: 'fontMetrics' } });
    expect(crash.sent.at(-1)?.message).toEqual({ type: 'error', id: 2, kind: 'unexpected', message: 'x is not a function' });
  });

  it('stops a running job when it gets `cancel`, and says so', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { sent, handle } = setup(async (_job, ctx) => {
      await gate;
      if (ctx.isCancelled?.()) throw new CancelledError();
      return { files: [new Uint8Array([1])] };
    });
    const running = handle({ type: 'run', id: 3, job: { op: 'fontMetrics' } });
    await handle({ type: 'cancel', id: 3 });
    release();
    await running;
    expect(sent.map((s) => s.message)).toEqual([{ type: 'cancelled', id: 3 }]);
  });

  it('reports "cancelled" even if the job finished anyway, and ignores a cancel for a job that is not running', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { sent, handle } = setup(async () => {
      await gate;
      return { files: [new Uint8Array([1])] };
    });
    await handle({ type: 'cancel', id: 99 }); // nothing running: must not poison id 99
    const running = handle({ type: 'run', id: 4, job: { op: 'fontMetrics' } });
    await handle({ type: 'cancel', id: 4 });
    release();
    await running;
    expect(sent.at(-1)?.message).toEqual({ type: 'cancelled', id: 4 });

    const again = setup(async () => ({ files: [new Uint8Array([1])] }) satisfies JobOutput);
    await again.handle({ type: 'cancel', id: 5 });
    await again.handle({ type: 'run', id: 5, job: { op: 'fontMetrics' } });
    expect(again.sent.at(-1)?.message.type).toBe('result');
  });

  it('toTransferable gives exact buffers (copying a view that is only part of its buffer)', () => {
    const whole = new Uint8Array([1, 2, 3]);
    expect(toTransferable(whole)).toBe(whole.buffer);
    const part = new Uint8Array([9, 1, 2, 3, 9]).subarray(1, 4);
    const buffer = toTransferable(part);
    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3]);
    expect(buffer.byteLength).toBe(3);
  });
});
