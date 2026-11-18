import { create } from 'zustand';
import { describeFeedsError, type FeedsError, type FeedsErrorCode, getDiscoverApi } from './api';
import { loadCache, type Slot, type SlotMap, saveCache } from './cache';
import { chunk, ITEMS_PER_FEED, URLS_PER_REQUEST } from './logic';
import type { FeedRef, FeedsResponse } from './types';

/** Fetched feeds younger than this aren't fetched again on navigation (the server caches for 10 minutes too). */
export const STALE_MS = 8 * 60_000;
/** How often an open page refreshes itself. */
export const AUTO_REFRESH_MS = 15 * 60_000;

type FeedState = {
  slots: SlotMap;
  /** Requests in flight. */
  pending: number;
  /** The last whole-request failure, until a request succeeds. */
  error: FeedsErrorCode | null;
  load: (feeds: readonly FeedRef[], opts?: { force?: boolean }) => Promise<void>;
  /** Put an already-fetched feed in (the "add a feed" probe fetched it). */
  seed: (response: FeedsResponse) => void;
  reset: () => void;
};

/** Never fetched, or old — or a failed one, once a minute has passed (a dead feed shouldn't be retried on every click). */
const needsFetch = (slot: Slot | undefined, now: number): boolean => !slot || (slot.error ? now - (slot.triedAt ?? 0) > 60_000 : now - slot.at > STALE_MS);

const initialSlots = (): SlotMap => (typeof localStorage === 'undefined' ? {} : loadCache());

const loading = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const saveSoon = (get: () => FeedState) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveCache(get().slots), 400);
};

const merge = (slots: SlotMap, response: FeedsResponse, now: number): SlotMap => {
  const next: SlotMap = { ...slots };
  for (const f of response.feeds) next[f.url] = { at: now, title: f.title, items: f.items };
  for (const f of response.failed) {
    const old = next[f.url];
    next[f.url] = { at: old?.at ?? 0, title: old?.title ?? '', items: old?.items ?? [], error: f.reason, triedAt: now };
  }
  return next;
};

export const useFeedStore = create<FeedState>()((set, get) => ({
  slots: initialSlots(),
  pending: 0,
  error: null,

  load: async (feeds, opts) => {
    const now = Date.now();
    const { slots } = get();
    const urls = [...new Set(feeds.map((f) => f.url).filter((url) => !loading.has(url) && (opts?.force || needsFetch(slots[url], now))))];
    if (!urls.length) return;
    for (const u of urls) loading.add(u);
    set((s) => ({ pending: s.pending + 1 }));
    try {
      const api = await getDiscoverApi();
      const results = await Promise.allSettled(chunk(urls, URLS_PER_REQUEST).map((group) => api.fetchFeeds(group, { limit: ITEMS_PER_FEED })));
      const failures: FeedsErrorCode[] = [];
      const answered: FeedsResponse = { feeds: [], failed: [] };
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          answered.feeds.push(...r.value.feeds);
          answered.failed.push(...r.value.failed);
        } else {
          failures.push((r.reason as Partial<FeedsError>)?.code ?? 'unavailable');
          // the group's feeds keep what they had, marked as failed
          for (const url of chunk(urls, URLS_PER_REQUEST)[i] ?? []) answered.failed.push({ url, reason: 'unreachable' });
        }
      });
      set((s) => ({ slots: merge(s.slots, answered, Date.now()), error: !answered.feeds.length ? (failures[0] ?? null) : null }));
      saveSoon(get);
    } finally {
      for (const u of urls) loading.delete(u);
      set((s) => ({ pending: Math.max(0, s.pending - 1) }));
    }
  },

  seed: (response) => {
    set((s) => ({ slots: merge(s.slots, { feeds: response.feeds, failed: [] }, Date.now()) }));
    saveSoon(get);
  },

  reset: () => {
    loading.clear();
    set({ slots: {}, pending: 0, error: null });
  },
}));

/** What the page says when the whole request failed. */
export const errorMessage = (code: FeedsErrorCode | null): string | null => (code ? describeFeedsError(code) : null);

export type { Slot };
