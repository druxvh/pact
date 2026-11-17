import type { Usage, UsageEntry } from '@/lib/omnibox/types';

const DAY = 86_400_000;
const HALF_LIFE_DAYS = 14;
const MAX_ENTRIES = 160;
const MAX_PINNED = 12;
export const PIN_BOOST = 260;

export const emptyUsage = (): Usage => ({ entries: {}, pinned: [] });

/** How "hot" something is: grows with use (logarithmically), halves every two weeks of not using it. */
export function frecency(entry: UsageEntry | undefined, now: number): number {
  if (!entry) return 0;
  const age = Math.max(0, now - entry.t) / DAY;
  return Math.log2(1 + entry.n) * 0.5 ** (age / HALF_LIFE_DAYS);
}

/**
 * Ranking bonus for `key`. A habit is worth at most 90 points (and never more than 60% of the match itself), which
 * reorders equally good matches but can't lift a prefix match over an exact one (a 100-point gap).
 */
export function usageBoost(usage: Usage, key: string, matchScore: number, now: number): number {
  const pin = usage.pinned.includes(key) ? PIN_BOOST : 0;
  const hot = Math.min(90, frecency(usage.entries[key], now) * 55);
  return Math.min(pin + hot, matchScore * 0.6 + pin);
}

function prune(entries: Record<string, UsageEntry>, now: number): Record<string, UsageEntry> {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_ENTRIES) return entries;
  const keep = keys.sort((a, b) => frecency(entries[b], now) - frecency(entries[a], now)).slice(0, MAX_ENTRIES);
  return Object.fromEntries(keep.map((k) => [k, entries[k] as UsageEntry]));
}

export function recordUsage(usage: Usage, key: string, now = Date.now()): Usage {
  const prev = usage.entries[key];
  const entries = prune({ ...usage.entries, [key]: { n: (prev?.n ?? 0) + 1, t: now } }, now);
  return { ...usage, entries };
}

export function forgetUsage(usage: Usage, key: string): Usage {
  if (!(key in usage.entries) && !usage.pinned.includes(key)) return usage;
  const { [key]: _gone, ...entries } = usage.entries;
  return { entries, pinned: usage.pinned.filter((k) => k !== key) };
}

export function togglePinned(usage: Usage, key: string): Usage {
  if (usage.pinned.includes(key)) return { ...usage, pinned: usage.pinned.filter((k) => k !== key) };
  return { ...usage, pinned: [key, ...usage.pinned].slice(0, MAX_PINNED) };
}
