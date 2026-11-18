import { describe, expect, it, vi } from 'vitest';
import { createCountdown, isTimerSeconds, nextTimer, type Scheduler, TIMER_OPTIONS, timerLabel } from '@/features/camera/countdown';

/** A hand-cranked clock: `step()` runs whatever was scheduled, once. */
function manualScheduler() {
  let next: (() => void) | null = null;
  let handle = 0;
  const scheduler: Scheduler = {
    set: (fn) => {
      next = fn;
      return ++handle;
    },
    clear: () => {
      next = null;
    },
  };
  return {
    scheduler,
    step: () => {
      const fn = next;
      next = null;
      fn?.();
    },
    pending: () => next !== null,
  };
}

function setup() {
  const clock = manualScheduler();
  const ticks: Array<number | null> = [];
  const onDone = vi.fn();
  const c = createCountdown({ onTick: (n) => ticks.push(n), onDone, scheduler: clock.scheduler });
  return { c, clock, ticks, onDone };
}

describe('the self-timer state machine', () => {
  it('counts 3, 2, 1 and then fires exactly once', () => {
    const { c, clock, ticks, onDone } = setup();
    c.start(3);
    expect(c.remaining).toBe(3);
    expect(ticks).toEqual([3]);
    clock.step();
    clock.step();
    expect(ticks).toEqual([3, 2, 1]);
    expect(onDone).not.toHaveBeenCalled();
    clock.step();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(ticks.at(-1)).toBeNull();
    expect(c.remaining).toBeNull();
    expect(clock.pending()).toBe(false);
  });

  it('cancel() stops it for good and never fires', () => {
    const { c, clock, ticks, onDone } = setup();
    c.start(5);
    clock.step();
    expect(c.cancel()).toBe(true);
    expect(c.remaining).toBeNull();
    expect(ticks.at(-1)).toBeNull();
    clock.step();
    clock.step();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('cancel() with nothing running says so and stays quiet', () => {
    const { c, ticks } = setup();
    expect(c.cancel()).toBe(false);
    expect(ticks).toEqual([]);
  });

  it('starting again restarts from the new number, and the old run cannot fire', () => {
    const { c, clock, ticks, onDone } = setup();
    c.start(10);
    clock.step();
    c.start(3);
    expect(ticks.at(-1)).toBe(3);
    clock.step();
    clock.step();
    clock.step();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('ignores 0 and negative seconds', () => {
    const { c, ticks, onDone } = setup();
    c.start(0);
    c.start(-4);
    expect(ticks).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();
    expect(c.remaining).toBeNull();
  });

  it('can run again after finishing', () => {
    const { c, clock, onDone } = setup();
    c.start(1);
    clock.step();
    c.start(1);
    clock.step();
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it('works with the real timer too', () => {
    vi.useFakeTimers();
    try {
      const onDone = vi.fn();
      const c = createCountdown({ onTick: () => {}, onDone });
      c.start(2);
      vi.advanceTimersByTime(1999);
      expect(onDone).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onDone).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('timer options', () => {
  it('cycle Off → 3 → 5 → 10 → Off', () => {
    expect(TIMER_OPTIONS).toEqual([0, 3, 5, 10]);
    expect(nextTimer(0)).toBe(3);
    expect(nextTimer(3)).toBe(5);
    expect(nextTimer(5)).toBe(10);
    expect(nextTimer(10)).toBe(0);
  });

  it('validates and labels', () => {
    expect(isTimerSeconds(5)).toBe(true);
    expect(isTimerSeconds(4)).toBe(false);
    expect(isTimerSeconds('3')).toBe(false);
    expect(timerLabel(0)).toBe('Off');
    expect(timerLabel(10)).toBe('10 s');
  });
});
