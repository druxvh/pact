/**
 * The self-timer: a tiny state machine, separate from React so its rules are easy to test.
 *
 *   idle ──start(n)──▶ counting(n) ──tick──▶ counting(n-1) … ──▶ done (fires once) ──▶ idle
 *                         └────────cancel()────────────────────────────▶ idle (never fires)
 */
export const TIMER_OPTIONS = [0, 3, 5, 10] as const;
export type TimerSeconds = (typeof TIMER_OPTIONS)[number];

export const isTimerSeconds = (v: unknown): v is TimerSeconds => v === 0 || v === 3 || v === 5 || v === 10;

/** The next option in the cycle Off → 3 s → 5 s → 10 s → Off (the `T` key). */
export function nextTimer(current: TimerSeconds): TimerSeconds {
  const i = TIMER_OPTIONS.indexOf(current);
  return TIMER_OPTIONS[(i + 1) % TIMER_OPTIONS.length] ?? 0;
}

export const timerLabel = (s: TimerSeconds): string => (s === 0 ? 'Off' : `${s} s`);

export type Scheduler = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realScheduler: Scheduler = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export type Countdown = {
  /** Begin counting down from `seconds`. A countdown already running is restarted. No-op for `seconds <= 0`. */
  start: (seconds: number) => void;
  /** Stop without firing `onDone`. Returns whether anything was running. */
  cancel: () => boolean;
  /** Seconds left, or `null` when idle. */
  readonly remaining: number | null;
};

export function createCountdown(opts: { onTick: (remaining: number | null) => void; onDone: () => void; scheduler?: Scheduler; stepMs?: number }): Countdown {
  const sched = opts.scheduler ?? realScheduler;
  const step = opts.stepMs ?? 1000;
  let remaining: number | null = null;
  let handle: unknown;

  const clear = () => {
    if (handle !== undefined) sched.clear(handle);
    handle = undefined;
  };

  const schedule = () => {
    handle = sched.set(() => {
      handle = undefined;
      if (remaining === null) return;
      remaining -= 1;
      if (remaining <= 0) {
        remaining = null;
        opts.onTick(null);
        opts.onDone();
        return;
      }
      opts.onTick(remaining);
      schedule();
    }, step);
  };

  return {
    start(seconds) {
      clear();
      if (!(seconds > 0)) return;
      remaining = Math.floor(seconds);
      opts.onTick(remaining);
      schedule();
    },
    cancel() {
      const was = remaining !== null;
      clear();
      remaining = null;
      if (was) opts.onTick(null);
      return was;
    },
    get remaining() {
      return remaining;
    },
  };
}
