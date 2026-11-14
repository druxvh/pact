export type PomodoroMode = 'idle' | 'focus' | 'break';

export type MiniToolsState = {
  pomodoroMinutes: number;
  pomodoroMode: PomodoroMode;
  quickNote: string;
};
