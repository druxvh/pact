import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MiniToolsState, PomodoroMode } from '@/features/timer/types';

type TimerState = MiniToolsState & {
  secondsLeft: number;
  isRunning: boolean;
  setPomodoroMode: (mode: PomodoroMode) => void;
  setPomodoroMinutes: (m: number) => void;
  setQuickNote: (quickNote: string) => void;
  start: () => void;
  pause: () => void;
  reset: () => void;
  tick: () => void;
};

const durations: Record<PomodoroMode, number> = {
  idle: 25,
  focus: 25,
  break: 5,
};

export const useToolsStore = create<TimerState>()(
  persist(
    (set, get) => ({
      pomodoroMinutes: 25,
      pomodoroMode: 'idle',
      quickNote: '',
      secondsLeft: 25 * 60,
      isRunning: false,
      setPomodoroMode: (pomodoroMode) => {
        const mins = durations[pomodoroMode];
        set({ pomodoroMode, pomodoroMinutes: mins, secondsLeft: mins * 60, isRunning: false });
      },
      setPomodoroMinutes: (pomodoroMinutes) => set({ pomodoroMinutes, secondsLeft: pomodoroMinutes * 60, isRunning: false }),
      setQuickNote: (quickNote) => set({ quickNote }),
      start: () => set({ isRunning: true }),
      pause: () => set({ isRunning: false }),
      reset: () => {
        const { pomodoroMode } = get();
        const mins = durations[pomodoroMode] ?? get().pomodoroMinutes;
        set({ secondsLeft: mins * 60, isRunning: false });
      },
      tick: () =>
        set((s) => {
          if (!s.isRunning) return s;
          if (s.secondsLeft <= 1) return { secondsLeft: 0, isRunning: false };
          return { secondsLeft: s.secondsLeft - 1 };
        }),
    }),
    {
      name: 'pact-tools',
      partialize: (s) => ({ pomodoroMinutes: s.pomodoroMinutes, pomodoroMode: s.pomodoroMode, quickNote: s.quickNote }),
    },
  ),
);
