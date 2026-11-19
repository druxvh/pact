import type { SessionRecord } from '@/features/timer/store';

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** Focus sessions only — breaks don't count towards stats. */
const focusOnly = (sessions: SessionRecord[]) => sessions.filter((s) => s.phase === 'focus');

export type DayStat = { date: Date; key: string; minutes: number; sessions: number };

export function todayStats(sessions: SessionRecord[], now = new Date()): { sessions: number; minutes: number } {
  const key = dayKey(now);
  const today = focusOnly(sessions).filter((s) => dayKey(new Date(s.completedAt)) === key);
  return { sessions: today.length, minutes: today.reduce((m, s) => m + s.minutes, 0) };
}

/** Focus minutes for each of the last `days` days (oldest → newest, ending today). */
export function lastDays(sessions: SessionRecord[], days = 7, now = new Date()): DayStat[] {
  const out: DayStat[] = [];
  const focus = focusOnly(sessions);
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = dayKey(date);
    const day = focus.filter((s) => dayKey(new Date(s.completedAt)) === key);
    out.push({ date, key, minutes: day.reduce((m, s) => m + s.minutes, 0), sessions: day.length });
  }
  return out;
}

/**
 * Consecutive days (ending today, or yesterday if nothing yet today) with ≥ 1 focus session.
 * Not having focused *yet* today doesn't break a streak.
 */
export function streak(sessions: SessionRecord[], now = new Date()): number {
  const days = new Set(focusOnly(sessions).map((s) => dayKey(new Date(s.completedAt))));
  let count = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor))) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

export function totalFocusMinutes(sessions: SessionRecord[]): number {
  return focusOnly(sessions).reduce((m, s) => m + s.minutes, 0);
}
