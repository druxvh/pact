/**
 * The last response, kept on this device so the page paints instantly and then refreshes in the background
 * (stale-while-revalidate). It is a cache, not data: it holds no article bodies (they're large and untrusted), is capped,
 * is not part of backups, and is wiped when a different account signs in (see lib/supabase/owner.ts).
 */
import { toArticle } from './logic';
import type { Article } from './types';

export const DISCOVER_CACHE_KEY = 'pact-discover-cache';
const VERSION = 1;
/** Total articles kept across all feeds — about 300 KB of JSON. */
export const CACHE_MAX_ITEMS = 420;

export type Slot = {
  /** When the feed was last fetched successfully (ms). */
  at: number;
  title: string;
  items: Article[];
  /** Set when the last attempt failed (the items shown are from an earlier one). */
  error?: string;
  /** When that failed attempt was made (ms). */
  triedAt?: number;
};

export type SlotMap = Record<string, Slot>;

/** Items without their body — what is stored. */
export const slim = (a: Article): Article => ({ ...a, contentHtml: '' });

/** Trim to the cap, keeping the most recently fetched feeds whole; bodies removed. */
export function trimForCache(slots: SlotMap, maxItems = CACHE_MAX_ITEMS): SlotMap {
  const out: SlotMap = {};
  let left = maxItems;
  for (const [url, slot] of Object.entries(slots).sort((a, b) => b[1].at - a[1].at)) {
    if (left <= 0) break;
    const items = slot.items.slice(0, left).map(slim);
    left -= items.length;
    out[url] = { at: slot.at, title: slot.title, items };
  }
  return out;
}

export function parseCache(raw: string | null): SlotMap {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as { v?: unknown; feeds?: unknown };
    if (v?.v !== VERSION || typeof v.feeds !== 'object' || v.feeds === null) return {};
    const out: SlotMap = {};
    for (const [url, s] of Object.entries(v.feeds as Record<string, unknown>).slice(0, 200)) {
      const o = (s ?? {}) as { at?: unknown; title?: unknown; items?: unknown };
      if (!url.startsWith('https://') || typeof o.at !== 'number' || !Number.isFinite(o.at) || !Array.isArray(o.items)) continue;
      const items = o.items
        .slice(0, 60)
        .map(toArticle)
        .filter((a): a is Article => a !== null);
      out[url] = { at: o.at, title: typeof o.title === 'string' ? o.title.slice(0, 100) : '', items: items.map(slim) };
    }
    return out;
  } catch {
    return {};
  }
}

export function loadCache(): SlotMap {
  try {
    return parseCache(localStorage.getItem(DISCOVER_CACHE_KEY));
  } catch {
    return {};
  }
}

export function saveCache(slots: SlotMap): void {
  try {
    localStorage.setItem(DISCOVER_CACHE_KEY, JSON.stringify({ v: VERSION, feeds: trimForCache(slots) }));
  } catch {
    /* storage full or unavailable: the page still works, it just starts empty next time */
  }
}
