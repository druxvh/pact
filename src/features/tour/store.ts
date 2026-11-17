import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { looksLikeFreshInstall, type TourKind } from '@/features/tour/logic';
import { syncAcrossTabs } from '@/lib/persist';

export const TOUR_KEY = 'pact-tour';

type TourState = {
  /** Which tours have been finished or skipped — they never start by themselves again. */
  completed: Record<TourKind, boolean>;
  /** The welcome flow asked for the tour; it starts as soon as the screen is calm. */
  requested: boolean;

  // ephemeral — never stored, so a reload doesn't resume a half-seen tour
  active: boolean;
  kind: TourKind;
  index: number;

  /** Hand-off from the welcome flow: "start the tour when you can". */
  request: () => void;
  /** Start now (auto-start, or "Replay tour" in Settings — which works even if it was seen before). */
  start: (kind: TourKind) => void;
  goTo: (index: number) => void;
  /** Close the tour — finished or skipped, either way it counts as seen. */
  finish: () => void;
  /** Mark a tour as seen without showing it (someone who was here before the tour existed). */
  markSeen: (kind: TourKind) => void;
};

/**
 * Read before the store exists: a device with no pact data at all is a brand-new install, whose first visit gets the tour.
 * Anything else with no tour record yet is someone who used pact before the tour shipped — they're marked as having seen
 * it. (The answer is written down right away, so a quick reload on day one doesn't turn a newcomer into a "returning user".)
 */
function firstRunState(): Pick<TourState, 'completed'> {
  try {
    const stored = localStorage.getItem(TOUR_KEY) !== null;
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? '');
    return { completed: { guest: !stored && !looksLikeFreshInstall(keys, TOUR_KEY), full: false } };
  } catch {
    return { completed: { guest: true, full: false } };
  }
}

export const useTourStore = create<TourState>()(
  persist(
    (set) => ({
      ...firstRunState(),
      requested: false,
      active: false,
      kind: 'full',
      index: 0,

      request: () => set({ requested: true, completed: { guest: true, full: false } }),
      start: (kind) => set({ active: true, kind, index: 0, requested: false }),
      goTo: (index) => set({ index: Math.max(0, index) }),
      finish: () => set((s) => ({ active: false, index: 0, requested: false, completed: { ...s.completed, [s.kind]: true } })),
      markSeen: (kind) => set((s) => ({ completed: { ...s.completed, [kind]: true } })),
    }),
    {
      name: TOUR_KEY,
      version: 1,
      partialize: (s) => ({ completed: s.completed, requested: s.requested }),
      merge: (persisted, current) => {
        // Nothing stored yet: keep the first-run answer computed above (zustand still calls `merge` with `undefined`).
        if (!persisted) return current;
        const p = persisted as { completed?: Partial<Record<TourKind, unknown>>; requested?: unknown };
        return {
          ...current,
          completed: { guest: p.completed?.guest === true, full: p.completed?.full === true },
          requested: p.requested === true,
        };
      },
    },
  ),
);

// Persist the first-run answer immediately (a no-op update is enough to make the middleware write).
try {
  if (localStorage.getItem(TOUR_KEY) === null) useTourStore.setState({});
} catch {
  /* storage unavailable — the tour simply won't be remembered */
}

syncAcrossTabs(TOUR_KEY, useTourStore);
