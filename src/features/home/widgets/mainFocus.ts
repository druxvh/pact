/**
 * The pure rules behind Home's "Main focus": one intention per local calendar day, a streak of days it was completed.
 *
 * Everything is derived from `YYYY-MM-DD` strings, never from timers: "today" is whatever the clock says *now*, so a tab
 * left open past midnight, a laptop that slept for a weekend or a gap of three weeks all just work — yesterday's entry stops
 * being today's the moment the date string changes, and nothing needs to "reset".
 */
import { dateKey } from '@/features/home/widgets/today';

export type FocusEntry = {
  /** Local calendar date, `YYYY-MM-DD`. */
  day: string;
  text: string;
  /** When it was checked off (ISO time), or `null` while it's still open. */
  doneAt: string | null;
};

export const MAX_FOCUS_CHARS = 120;
/** Two years of days: far more than anyone's streak, and still only a few tens of kB. */
export const MAX_ENTRIES = 730;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in `YYYY-MM-DD` form (rejects `2026-02-30`). */
export function isDayKey(v: unknown): v is string {
  const m = typeof v === 'string' ? DAY_RE.exec(v) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

const parts = (day: string): [number, number, number] => {
  const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
  return [y, m, d];
};

/** `day` shifted by `n` calendar days. Built from date parts (at noon), so daylight-saving changes can't skip or repeat a day. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return dateKey(new Date(y, m - 1, d + n, 12));
}

/** Whole calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const utc = (key: string) => {
    const [y, m, d] = parts(key);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** One line, collapsed whitespace, capped. */
export function cleanFocusText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_FOCUS_CHARS).trimEnd();
}

/** Coerce anything from storage (an older build, a hand edit, an import) into a sorted, de-duplicated, capped list. */
export function sanitizeEntries(raw: unknown): FocusEntry[] {
  if (!Array.isArray(raw)) return [];
  const byDay = new Map<string, FocusEntry>();
  for (const item of raw) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    if (!isDayKey(r.day) || typeof r.text !== 'string') continue;
    const text = cleanFocusText(r.text);
    if (!text) continue;
    const doneAt = typeof r.doneAt === 'string' && !Number.isNaN(Date.parse(r.doneAt)) ? r.doneAt : null;
    byDay.set(r.day, { day: r.day, text, doneAt });
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-MAX_ENTRIES);
}

export const entryFor = (entries: readonly FocusEntry[], day: string): FocusEntry | null => entries.find((e) => e.day === day) ?? null;

/** Set (or replace) the focus for `day`. Empty text removes it. Editing keeps the done mark. */
export function setFocus(entries: readonly FocusEntry[], day: string, text: string): FocusEntry[] {
  const clean = cleanFocusText(text);
  const rest = entries.filter((e) => e.day !== day);
  if (!clean) return rest;
  const was = entryFor(entries, day);
  const next: FocusEntry = { day, text: clean, doneAt: was?.doneAt ?? null };
  return [...rest, next].sort((a, b) => a.day.localeCompare(b.day)).slice(-MAX_ENTRIES);
}

/** Check today's focus off, or take the check back. Does nothing when there is no focus for `day`. */
export function toggleDone(entries: readonly FocusEntry[], day: string, nowIso: string): FocusEntry[] {
  return entries.map((e) => (e.day === day ? { ...e, doneAt: e.doneAt ? null : nowIso } : e));
}

/** The most recent focus before `day` — "yesterday", or the last one you set if you've been away. */
export function previousEntry(entries: readonly FocusEntry[], day: string): FocusEntry | null {
  let best: FocusEntry | null = null;
  for (const e of entries) if (e.day < day && (best === null || e.day > best.day)) best = e;
  return best;
}

/**
 * Consecutive days, ending today, whose focus was completed. Not having finished *today's* yet doesn't break it (the
 * count then ends yesterday), but one missed day does — and so does a gap of many days.
 */
export function streak(entries: readonly FocusEntry[], today: string): number {
  const done = new Set(entries.filter((e) => e.doneAt).map((e) => e.day));
  let cursor = done.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (done.has(cursor)) {
    count++;
    cursor = addDays(cursor, -1);
  }
  return count;
}

/** Milliseconds until the next local midnight — only used to know when to re-render, never to decide what "today" is. */
export function msUntilNextDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
}

/** "Yesterday", "Mon" (within the last week) or "Nov 12". */
export function relativeDay(day: string, today: string): string {
  const diff = daysBetween(day, today);
  if (diff === 1) return 'Yesterday';
  const [y, m, d] = parts(day);
  const date = new Date(y, m - 1, d, 12);
  return diff > 1 && diff < 7
    ? date.toLocaleDateString(undefined, { weekday: 'long' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
