/** Things you can *do* from the omnibox rather than look up. Parsed here (pure); the app turns them into actions. */
export type Intent =
  | { kind: 'timer'; minutes: number; label: string }
  // `explicit` = written `note: …`: the user clearly meant it, so it may be the default action
  | { kind: 'note'; text: string; explicit: boolean }
  | { kind: 'task'; text: string; explicit: boolean };

const TIMER_A = /^(?:set\s+(?:a\s+)?)?(?:timer|countdown)(?:\s+for)?\s+(.{1,40})$/i;
const TIMER_B = /^(?:set\s+(?:a\s+)?)?(.{1,40}?)\s+(?:timer|countdown)$/i;
const POMODORO = /^pomodoro\s+(.{1,40})$/i;
const NOTE = /^(?:new\s+|add\s+)?note(\s*:\s*|\s+)([\s\S]+)$/i;
const TASK = /^(?:new\s+|add\s+)?(?:task|todo)(\s*:\s*|\s+)([\s\S]+)$/i;

// Each repetition ends in a unit (or the whole thing is one bare number), so there is only one way to split the text.
const DURATION = /^(?:\d+(?:\.\d+)?\s*(?:h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)(?![a-z])\s*(?:and\s+)?)+$|^\d+(?:\.\d+)?$/i;

/** "25", "25m", "1h30m", "1 h 30 min", "90s", "1.5 hours" → minutes. A bare number is minutes. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!DURATION.test(t)) return null;
  let minutes = 0;
  for (const p of t.matchAll(/(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)?/g)) {
    const n = Number(p[1]);
    const u = p[2] ?? 'm';
    minutes += u.startsWith('h') ? n * 60 : u.startsWith('s') ? n / 60 : n;
  }
  return minutes > 0 && minutes <= 24 * 60 ? Math.round(minutes * 60) / 60 : null;
}

/** "25 min", "1 h 30 min", "45 s" */
export function describeMinutes(minutes: number): string {
  const total = Math.round(minutes * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [h ? `${h} h` : '', m ? `${m} min` : '', s ? `${s} s` : ''].filter(Boolean);
  return parts.join(' ') || '0 min';
}

export function parseIntent(input: string): Intent | null {
  const text = input.trim();
  if (!text || text.length > 500) return null;
  for (const re of [TIMER_A, TIMER_B, POMODORO]) {
    const minutes = parseDuration(re.exec(text)?.[1] ?? '');
    if (minutes) return { kind: 'timer', minutes, label: describeMinutes(minutes) };
  }
  const note = NOTE.exec(text);
  if (note?.[2]?.trim()) return { kind: 'note', text: note[2].trim(), explicit: note[1]?.includes(':') ?? false };
  const task = TASK.exec(text);
  if (task?.[2]?.trim()) return { kind: 'task', text: task[2].trim(), explicit: task[1]?.includes(':') ?? false };
  return null;
}
