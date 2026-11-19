/**
 * What a running PDF job can tell the outside world (progress) and be told (cancel). Operations take an optional
 * context and call `checkpoint` between steps, so the same code runs in a Web Worker and, if one can't start, on the
 * main thread — where the periodic yield keeps the page responsive and a cancel takes effect at the next step.
 */
import { CancelledError } from './errors';

export type Progress = {
  /** Steps finished so far; may be fractional (e.g. half-way through the second file). */
  done: number;
  /** Total steps; 0 means "unknown" (the bar is shown as indeterminate). */
  total: number;
  label: string;
};

export type JobContext = {
  report?: (progress: Progress) => void;
  isCancelled?: () => boolean;
  /** Lets other work run. Defaults to a macrotask hop (`MessageChannel`, else `setTimeout`). */
  yieldNow?: () => Promise<void>;
};

/** How long a job may run before it lets the event loop breathe (ms). */
const SLICE_MS = 12;
let lastYield = 0;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function defaultYield(): Promise<void> {
  if (typeof MessageChannel === 'function') {
    return new Promise((resolve) => {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = () => {
        port1.close();
        resolve();
      };
      port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Throws `CancelledError` if the job was canceled. */
export function throwIfCancelled(ctx?: JobContext): void {
  if (ctx?.isCancelled?.()) throw new CancelledError();
}

/**
 * Call between steps of a job: reports progress, honours cancel, and (time-sliced) yields to the event loop so a
 * `cancel` message — or the UI, on the main thread — gets a turn.
 */
export async function checkpoint(ctx: JobContext | undefined, done: number, total: number, label: string): Promise<void> {
  if (!ctx) return;
  throwIfCancelled(ctx);
  ctx.report?.({ done, total, label });
  if (now() - lastYield >= SLICE_MS) {
    await (ctx.yieldNow ?? defaultYield)();
    lastYield = now();
    throwIfCancelled(ctx);
  }
}

/** Progress as 0–1 (or `null` while the total is unknown). */
export function fraction(p: Progress): number | null {
  if (!(p.total > 0)) return null;
  return Math.min(1, Math.max(0, p.done / p.total));
}

/** Squeeze a job's own 0–1 progress into a slice of a bigger bar (e.g. render = 0–0.8, build = 0.8–1), in thousandths. */
export function inBand(p: Progress, from: number, to: number): Progress {
  const f = fraction(p) ?? 0;
  return { done: Math.round((from + (to - from) * f) * 1000), total: 1000, label: p.label };
}

/** Wrap `report` so it fires at most every `ms` (the final step always goes through). */
export function throttleReport(report: (p: Progress) => void, ms = 60): (p: Progress) => void {
  let last = -Infinity;
  return (p) => {
    const t = now();
    if (t - last >= ms || (p.total > 0 && p.done >= p.total)) {
      last = t;
      report(p);
    }
  };
}
