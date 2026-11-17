/**
 * Pure helpers for slowmode and timeouts: the choices a moderator gets, how waits and end times read, and how long a
 * person still has to wait. The database enforces the rules; these only decide what to show (and when to stop showing it).
 */

/** The slowmode choices, in seconds (0 = off). The server accepts 0–21600. */
export const SLOWMODE_OPTIONS = [0, 5, 10, 30, 60, 300, 900, 3600, 21600] as const;
export const SLOWMODE_MAX_SECONDS = 21600;

/** The timeout choices a moderator gets. The server accepts up to 28 days. */
export const TIMEOUT_OPTIONS = [
  { seconds: 60, label: '60 seconds' },
  { seconds: 300, label: '5 minutes' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 86400, label: '1 day' },
  { seconds: 604800, label: '1 week' },
] as const;
export const TIMEOUT_MAX_SECONDS = 28 * 86400;

/** "Off", "5 seconds", "1 minute", "6 hours" — for pickers and sentences. */
export function slowmodeLabel(seconds: number): string {
  if (seconds <= 0) return 'Off';
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  if (seconds < 3600) {
    const m = Math.round(seconds / 60);
    return `${m} minute${m === 1 ? '' : 's'}`;
  }
  const h = Math.round(seconds / 3600);
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/** "5s", "1m", "6h" — for the small badge in a channel header. */
export function slowmodeShort(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

/** A countdown: "9s", "1m 05s", "2h 03m". Rounds up, so it never says 0 while there is still time. */
export function formatWait(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (s < 3600) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Is a timeout still in force? (`until` is an ISO time from the server.) */
export function timeoutActive(until: string | null | undefined, now: number): boolean {
  if (!until) return false;
  const t = Date.parse(until);
  return Number.isFinite(t) && t > now;
}

/** "3:45 PM" for today, "Thu, Nov 19, 3:45 PM" for another day. */
export function formatUntil(iso: string, now: number = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'later';
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`;
}

/**
 * How many ms until this person may send in a channel again. Moderators and the admin are never slowed (`exempt`).
 *  - `cooldownUntil` (our own clock, set right after a send or from the server's `slowmode:<n>` answer) is exact, because it
 *    only ever measures elapsed time — so when we have one, it is the whole answer;
 *  - otherwise (after a reload) it is the time of my last message in the loaded history, which is server time. If this
 *    computer's clock is behind (that message looks like it is from the future) we can't tell, so we let the person try and
 *    the server's answer sets a cooldown; the wait is never longer than the slowmode itself.
 */
export function slowmodeRemainingMs(o: {
  slowmodeSeconds: number;
  exempt: boolean;
  lastOwnAt: string | null | undefined;
  cooldownUntil: number | undefined;
  now: number;
}): number {
  if (o.exempt || o.slowmodeSeconds <= 0) return 0;
  if (o.cooldownUntil !== undefined) return Math.max(0, Math.min(o.cooldownUntil - o.now, o.slowmodeSeconds * 1000));
  const last = o.lastOwnAt ? Date.parse(o.lastOwnAt) : Number.NaN;
  if (!Number.isFinite(last) || last - o.now > 5000) return 0;
  return Math.max(0, Math.min(last + o.slowmodeSeconds * 1000 - o.now, o.slowmodeSeconds * 1000));
}
