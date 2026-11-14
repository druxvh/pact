import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lastDays, streak, todayStats, totalFocusMinutes } from '@/features/timer/stats';
import { type SessionRecord, remainingNow, useTimerStore } from '@/features/timer/store';

const fresh = () => {
  localStorage.clear();
  useTimerStore.setState({
    phase: 'focus',
    status: 'idle',
    durations: { focus: 25, short: 5, long: 15 },
    endsAt: null,
    remainingMs: 25 * 60_000,
    cycle: 0,
    longEvery: 4,
    autoStart: false,
    intent: '',
    linkedTaskId: null,
    sessions: [],
    lastCompleted: null,
  });
};

describe('timer store (timestamp based)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T10:00:00'));
    fresh();
  });
  afterEach(() => vi.useRealTimers());

  it('derives remaining time from endsAt, so it is correct however long the tab was throttled', () => {
    useTimerStore.getState().start();
    const s = useTimerStore.getState();
    expect(s.status).toBe('running');
    expect(remainingNow(s)).toBe(25 * 60_000);
    vi.advanceTimersByTime(10 * 60_000); // 10 minutes pass with NO ticks
    expect(remainingNow(useTimerStore.getState())).toBe(15 * 60_000);
  });

  it('pause freezes the remaining time and resume continues from it', () => {
    useTimerStore.getState().start();
    vi.advanceTimersByTime(5 * 60_000);
    useTimerStore.getState().pause();
    expect(useTimerStore.getState()).toMatchObject({ status: 'paused', endsAt: null, remainingMs: 20 * 60_000 });
    vi.advanceTimersByTime(60 * 60_000); // an hour paused
    expect(remainingNow(useTimerStore.getState())).toBe(20 * 60_000);
    useTimerStore.getState().start();
    expect(remainingNow(useTimerStore.getState())).toBe(20 * 60_000);
  });

  it('reset honours the CURRENT phase and configured duration (it used to snap back to 25)', () => {
    useTimerStore.getState().setDurations({ focus: 45 });
    expect(useTimerStore.getState().remainingMs).toBe(45 * 60_000); // idle → dial updates immediately
    useTimerStore.getState().start();
    vi.advanceTimersByTime(60_000);
    useTimerStore.getState().reset();
    expect(useTimerStore.getState()).toMatchObject({ status: 'idle', remainingMs: 45 * 60_000 });
  });

  it('completes a focus session, records it, and moves to a short break', () => {
    useTimerStore.getState().setIntent('Write the README');
    useTimerStore.getState().start();
    vi.advanceTimersByTime(25 * 60_000);
    const done = useTimerStore.getState().complete();
    expect(done).toMatchObject({ phase: 'focus', intent: 'Write the README' });
    const s = useTimerStore.getState();
    expect(s).toMatchObject({ phase: 'short', status: 'idle', cycle: 1, remainingMs: 5 * 60_000 });
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0]).toMatchObject({ phase: 'focus', minutes: 25, intent: 'Write the README' });
  });

  it('is idempotent: completing when nothing is running (or twice) records nothing extra', () => {
    expect(useTimerStore.getState().complete()).toBeNull();
    useTimerStore.getState().start();
    vi.advanceTimersByTime(25 * 60_000);
    expect(useTimerStore.getState().complete()).not.toBeNull();
    expect(useTimerStore.getState().complete()).toBeNull(); // second tab arrives late
    expect(useTimerStore.getState().sessions).toHaveLength(1);
  });

  it('takes a long break after every 4th focus session, then resets the cycle', () => {
    const runPhase = () => {
      useTimerStore.getState().start();
      vi.advanceTimersByTime(60 * 60_000);
      useTimerStore.getState().complete();
    };
    const phases: string[] = [];
    const cycleAfter: number[] = [];
    for (let i = 0; i < 9; i++) {
      phases.push(useTimerStore.getState().phase);
      runPhase();
      cycleAfter.push(useTimerStore.getState().cycle);
    }
    expect(phases).toEqual(['focus', 'short', 'focus', 'short', 'focus', 'short', 'focus', 'long', 'focus']);
    // cycle counts focus sessions since the last long break: 1,1,2,2,3,3,4 → (long break) 0 → (focus) 1
    expect(cycleAfter).toEqual([1, 1, 2, 2, 3, 3, 4, 0, 1]);
  });

  it('auto-start rolls straight into the next phase', () => {
    useTimerStore.getState().setAutoStart(true);
    useTimerStore.getState().start();
    vi.advanceTimersByTime(25 * 60_000);
    useTimerStore.getState().complete();
    const s = useTimerStore.getState();
    expect(s.status).toBe('running');
    expect(s.phase).toBe('short');
    expect(remainingNow(s)).toBe(5 * 60_000);
  });

  it('skip never credits a session', () => {
    useTimerStore.getState().start();
    useTimerStore.getState().skip();
    expect(useTimerStore.getState()).toMatchObject({ phase: 'short', status: 'idle', cycle: 0 });
    expect(useTimerStore.getState().sessions).toHaveLength(0);
  });

  it('persists across a reload (state is plain data, not intervals)', () => {
    useTimerStore.getState().start();
    const persisted = JSON.parse(localStorage.getItem('pact-timer') ?? '{}').state;
    expect(persisted.status).toBe('running');
    expect(persisted.endsAt).toBe(Date.now() + 25 * 60_000);
  });
});

describe('focus stats (real, not the old hard-coded "2 sessions · 3 day streak")', () => {
  const NOW = new Date(2026, 10, 14, 15, 0); // Sat 14 Nov 2026
  const ses = (daysAgo: number, minutes = 25, phase: SessionRecord['phase'] = 'focus'): SessionRecord => ({
    id: `s${daysAgo}-${minutes}-${phase}`,
    phase,
    minutes,
    completedAt: new Date(2026, 10, 14 - daysAgo, 11, 0).toISOString(),
    intent: null,
    taskId: null,
  });

  it("sums today's focus only (breaks excluded)", () => {
    expect(todayStats([ses(0), ses(0, 50), ses(0, 5, 'short'), ses(1)], NOW)).toEqual({ sessions: 2, minutes: 75 });
    expect(todayStats([], NOW)).toEqual({ sessions: 0, minutes: 0 });
  });

  it('counts consecutive days, and a quiet morning does not break the streak', () => {
    expect(streak([ses(0), ses(1), ses(2)], NOW)).toBe(3);
    expect(streak([ses(1), ses(2)], NOW)).toBe(2); // nothing yet today
    expect(streak([ses(0), ses(2)], NOW)).toBe(1); // gap yesterday
    expect(streak([ses(3)], NOW)).toBe(0);
    expect(streak([], NOW)).toBe(0);
  });

  it('builds the 7-day series oldest → newest', () => {
    const days = lastDays([ses(0, 25), ses(0, 25), ses(6, 40), ses(8, 99)], 7, NOW);
    expect(days).toHaveLength(7);
    expect(days[6]?.minutes).toBe(50);
    expect(days[0]?.minutes).toBe(40);
    expect(days.reduce((m, d) => m + d.minutes, 0)).toBe(90); // the 8-days-ago session is outside the window
    expect(totalFocusMinutes([ses(0), ses(1, 10), ses(0, 5, 'long')])).toBe(35);
  });
});
