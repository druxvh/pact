import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type FocusEntry, sanitizeEntries, setFocus, toggleDone } from '@/features/home/widgets/mainFocus';
import { dateKey } from '@/features/home/widgets/today';
import { useTimerStore } from '@/features/timer/store';
import { syncAcrossTabs } from '@/lib/persist';
import { useNavStore } from '@/store/useNavStore';

export const MAIN_FOCUS_KEY = 'pact-main-focus';

type MainFocusState = {
  /** One entry per day that had a focus, oldest first. */
  entries: FocusEntry[];
  /** Set today's focus (empty text clears it). */
  setToday: (text: string, now?: Date) => void;
  /** Check today's focus off, or take the check back. */
  toggleToday: (now?: Date) => void;
};

/** Local only — it works for guests too, since nothing here needs an account. */
export const useMainFocusStore = create<MainFocusState>()(
  persist(
    (set) => ({
      entries: [],
      setToday: (text, now = new Date()) => set((s) => ({ entries: setFocus(s.entries, dateKey(now), text) })),
      toggleToday: (now = new Date()) => set((s) => ({ entries: toggleDone(s.entries, dateKey(now), now.toISOString()) })),
    }),
    {
      name: MAIN_FOCUS_KEY,
      version: 1,
      partialize: (s) => ({ entries: s.entries }),
      merge: (persisted, current) => ({ ...current, entries: sanitizeEntries((persisted as { entries?: unknown } | null)?.entries) }),
    },
  ),
);

syncAcrossTabs(MAIN_FOCUS_KEY, useMainFocusStore);

/**
 * "Start a focus session": hand the intention to the Focus timer and go there. Never disturbs a session that's already
 * under way — it just opens it — and a finished-phase break is switched back to a focus round so you land ready to start.
 */
export function startFocusSession(text: string): void {
  const timer = useTimerStore.getState();
  if (timer.status === 'idle') {
    if (timer.phase !== 'focus') timer.setPhase('focus');
    timer.setIntent(text);
  }
  useNavStore.getState().go('timer');
}
