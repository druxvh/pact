import { create } from 'zustand';
import type { MiniToolsState, PomodoroMode } from '@/types/tools';

type ToolsStore = MiniToolsState & {
  setPomodoroMode: (mode: PomodoroMode) => void;
  setQuickNote: (quickNote: string) => void;
};

export const useToolsStore = create<ToolsStore>((set) => ({
  pomodoroMinutes: 25,
  pomodoroMode: 'idle',
  quickNote: '',
  setPomodoroMode: (pomodoroMode) => set({ pomodoroMode }),
  setQuickNote: (quickNote) => set({ quickNote }),
}));
