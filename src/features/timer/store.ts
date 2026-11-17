import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { uid } from '@/lib/format';
import { syncAcrossTabs } from '@/lib/persist';
import { DEFAULT_PRESETS, MAX_PRESETS, sanitizePreset, type TimerPreset } from './presets';

export type Phase = 'focus' | 'short' | 'long';
export type TimerStatus = 'idle' | 'running' | 'paused';

export const PHASES: Phase[] = ['focus', 'short', 'long'];
export const PHASE_LABEL: Record<Phase, string> = { focus: 'Focus', short: 'Short break', long: 'Long break' };

export type SessionRecord = {
  id: string;
  phase: Phase;
  minutes: number;
  completedAt: string;
  intent: string | null;
  taskId: string | null;
  /** The custom timer this focus session ran under, if any. */
  presetId?: string | null;
};

export type Completion = { id: string; phase: Phase; at: number; intent: string | null; taskId: string | null };

type Durations = Record<Phase, number>;

type TimerState = {
  phase: Phase;
  status: TimerStatus;
  /** Minutes per phase. */
  durations: Durations;
  /**
   * Absolute epoch-ms when the running phase ends. The countdown is *derived* from this
   * (not decremented), so it survives navigation, reloads, sleep and background throttling.
   */
  endsAt: number | null;
  /** Remaining ms while idle/paused. */
  remainingMs: number;
  /** Focus sessions completed since the last long break. */
  cycle: number;
  longEvery: number;
  autoStart: boolean;
  intent: string;
  linkedTaskId: string | null;
  /** Custom timers (name + minutes + icon). Picking one sets the focus length. */
  presets: TimerPreset[];
  activePresetId: string | null;
  sessions: SessionRecord[];
  /** Most recent completion — other tabs use it to show the same toast/sound once. */
  lastCompleted: Completion | null;

  start: () => void;
  pause: () => void;
  reset: () => void;
  skip: () => void;
  setPhase: (phase: Phase) => void;
  setDurations: (patch: Partial<Durations>) => void;
  setAutoStart: (v: boolean) => void;
  setIntent: (v: string) => void;
  setLinkedTask: (id: string | null) => void;
  /** Add or update a custom timer; returns its id (null when the input is unusable or the list is full). */
  savePreset: (preset: Omit<TimerPreset, 'id'> & { id?: string }) => string | null;
  removePreset: (id: string) => void;
  /** Use a custom timer: switches to Focus with its length. Ignored while a timer is running. */
  applyPreset: (id: string) => void;
  /** Finish the running phase (idempotent — callers should go through completeOnce()). */
  complete: () => Completion | null;
  clearHistory: () => void;
};

const MAX_SESSIONS = 500;
const minutesToMs = (m: number) => Math.round(m * 60_000);

const DEFAULTS: Durations = { focus: 25, short: 5, long: 15 };

function nextAfter(phase: Phase, cycle: number, longEvery: number): { next: Phase; cycle: number } {
  if (phase === 'focus') {
    const c = cycle + 1;
    return { next: c >= longEvery ? 'long' : 'short', cycle: c };
  }
  return { next: 'focus', cycle: phase === 'long' ? 0 : cycle };
}

export const useTimerStore = create<TimerState>()(
  persist(
    (set, get) => ({
      phase: 'focus',
      status: 'idle',
      durations: DEFAULTS,
      endsAt: null,
      remainingMs: minutesToMs(DEFAULTS.focus),
      cycle: 0,
      longEvery: 4,
      autoStart: false,
      intent: '',
      linkedTaskId: null,
      presets: DEFAULT_PRESETS,
      activePresetId: null,
      sessions: [],
      lastCompleted: null,

      start: () =>
        set((s) => {
          if (s.status === 'running') return s;
          const ms = s.remainingMs > 0 ? s.remainingMs : minutesToMs(s.durations[s.phase]);
          return { status: 'running', endsAt: Date.now() + ms, remainingMs: ms };
        }),

      pause: () =>
        set((s) => {
          if (s.status !== 'running' || s.endsAt === null) return s;
          return { status: 'paused', endsAt: null, remainingMs: Math.max(0, s.endsAt - Date.now()) };
        }),

      reset: () => set((s) => ({ status: 'idle', endsAt: null, remainingMs: minutesToMs(s.durations[s.phase]) })),

      skip: () =>
        set((s) => {
          const next: Phase = s.phase === 'focus' ? 'short' : 'focus';
          return { phase: next, status: 'idle', endsAt: null, remainingMs: minutesToMs(s.durations[next]) };
        }),

      setPhase: (phase) => set((s) => ({ phase, status: 'idle', endsAt: null, remainingMs: minutesToMs(s.durations[phase]) })),

      setDurations: (patch) =>
        set((s) => {
          const durations = { ...s.durations, ...patch };
          // Editing the current phase while idle updates the dial immediately.
          const touchesCurrent = patch[s.phase] !== undefined && s.status === 'idle';
          return { durations, ...(touchesCurrent ? { remainingMs: minutesToMs(durations[s.phase]) } : null) };
        }),

      setAutoStart: (autoStart) => set({ autoStart }),
      setIntent: (intent) => set({ intent }),
      setLinkedTask: (linkedTaskId) => set({ linkedTaskId }),

      savePreset: (input) => {
        const existing = input.id ? get().presets.find((p) => p.id === input.id) : undefined;
        if (!existing && get().presets.length >= MAX_PRESETS) return null;
        const clean = sanitizePreset({ ...input, id: existing?.id ?? uid('preset') });
        if (!clean) return null;
        set((s) => {
          const presets = existing ? s.presets.map((p) => (p.id === clean.id ? clean : p)) : [...s.presets, clean];
          // Editing the timer that is in use re-points the idle dial at its new length straight away.
          const live = s.activePresetId === clean.id && s.status === 'idle' && s.phase === 'focus';
          return {
            presets,
            ...(live ? { durations: { ...s.durations, focus: clean.minutes }, remainingMs: minutesToMs(clean.minutes) } : null),
          };
        });
        return clean.id;
      },

      removePreset: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id), activePresetId: s.activePresetId === id ? null : s.activePresetId })),

      applyPreset: (id) =>
        set((s) => {
          const preset = s.presets.find((p) => p.id === id);
          if (!preset || s.status === 'running') return s;
          return {
            activePresetId: preset.id,
            phase: 'focus',
            status: 'idle',
            endsAt: null,
            durations: { ...s.durations, focus: preset.minutes },
            remainingMs: minutesToMs(preset.minutes),
          };
        }),

      complete: () => {
        const s = get();
        if (s.status !== 'running' || s.endsAt === null) return null;
        const finishedAt = Math.min(s.endsAt, Date.now());
        const record: SessionRecord = {
          id: uid('ses'),
          phase: s.phase,
          minutes: s.durations[s.phase],
          completedAt: new Date(finishedAt).toISOString(),
          intent: s.intent.trim() || null,
          taskId: s.linkedTaskId,
          presetId: s.phase === 'focus' ? (activePreset(s)?.id ?? null) : null,
        };
        const { next, cycle } = nextAfter(s.phase, s.cycle, s.longEvery);
        const ms = minutesToMs(s.durations[next]);
        const completion: Completion = {
          id: record.id,
          phase: s.phase,
          at: finishedAt,
          intent: record.intent,
          taskId: record.taskId,
        };
        set({
          phase: next,
          cycle,
          status: s.autoStart ? 'running' : 'idle',
          endsAt: s.autoStart ? Date.now() + ms : null,
          remainingMs: ms,
          sessions: [record, ...s.sessions].slice(0, MAX_SESSIONS),
          lastCompleted: completion,
        });
        return completion;
      },

      clearHistory: () => set({ sessions: [], cycle: 0, lastCompleted: null }),
    }),
    {
      name: 'pact-timer',
      version: 2,
      // v1 had no custom timers; the starter set arrives through the initial state's defaults.
      migrate: (persisted) => persisted as TimerState,
    },
  ),
);

syncAcrossTabs('pact-timer', useTimerStore);

/** The custom timer in effect: the chosen one, as long as the focus length still matches it (changing the length in Settings drops it). */
export function activePreset(s: Pick<TimerState, 'presets' | 'activePresetId' | 'durations'>): TimerPreset | undefined {
  const p = s.presets.find((x) => x.id === s.activePresetId);
  return p && p.minutes === s.durations.focus ? p : undefined;
}

/** Remaining ms right now, derived from state (never stale). */
export function remainingNow(s: Pick<TimerState, 'status' | 'endsAt' | 'remainingMs'>, now = Date.now()): number {
  return s.status === 'running' && s.endsAt !== null ? Math.max(0, s.endsAt - now) : s.remainingMs;
}

export function totalMs(s: Pick<TimerState, 'phase' | 'durations'>): number {
  return minutesToMs(s.durations[s.phase]);
}
