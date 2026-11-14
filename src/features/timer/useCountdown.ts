import { useEffect, useReducer } from 'react';
import { remainingNow, totalMs, useTimerStore } from '@/features/timer/store';

/**
 * Live remaining time, derived from the absolute `endsAt` — never decremented — so it
 * stays correct through reloads, sleep and background throttling. Re-renders once per
 * displayed second (aligned to the boundary), and only while running.
 */
export function useCountdown() {
  const status = useTimerStore((s) => s.status);
  const endsAt = useTimerStore((s) => s.endsAt);
  const remainingMs = useTimerStore((s) => s.remainingMs);
  const phase = useTimerStore((s) => s.phase);
  const durations = useTimerStore((s) => s.durations);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (status !== 'running' || endsAt === null) return;
    let timer: number;
    const tick = () => {
      bump();
      const rem = endsAt - Date.now();
      if (rem <= 0) return;
      // wait until the displayed (ceil'd) second would change
      const wait = rem - (Math.ceil(rem / 1000) - 1) * 1000;
      timer = window.setTimeout(tick, wait + 12);
    };
    tick();
    const onVisible = () => document.visibilityState === 'visible' && bump();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status, endsAt]);

  const remaining = remainingNow({ status, endsAt, remainingMs });
  const total = totalMs({ phase, durations });
  return {
    status,
    phase,
    remainingMs: remaining,
    totalMs: total,
    /** Whole seconds as displayed (ceil, so a fresh 25:00 shows 25:00 and 0:00 only at the very end). */
    seconds: Math.ceil(remaining / 1000),
    progress: total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : 0,
  };
}
