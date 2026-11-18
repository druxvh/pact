import { useEffect, useMemo, useState } from 'react';
import type { SlotMap } from './cache';
import { CATALOG } from './catalog';
import { AUTO_REFRESH_MS, useFeedStore } from './feedStore';
import { feedsForView, rankEntries, refOfCustom, refOfSource, savedToEntry, toEntries } from './logic';
import { useDiscoverStore } from './store';
import type { CustomFeed, Entry, FeedRef, View } from './types';

/** Re-render every `ms` (so "3m ago" keeps up) — returns the current time. */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export type DiscoverFeed = {
  feeds: FeedRef[];
  entries: Entry[];
  /** Feeds that have never loaded successfully and are not loading now. */
  failed: FeedRef[];
  loading: boolean;
  error: ReturnType<typeof useFeedStore.getState>['error'];
  /** When the newest data in this view was fetched (ms), or null. */
  updatedAt: number | null;
  refresh: () => void;
};

/**
 * The articles for one view, painted from what is already on the device and refreshed in the background — on arrival (for
 * anything stale), when the tab becomes visible again after a while, and every ~15 minutes while open.
 */
export function useDiscoverFeed(view: View): DiscoverFeed {
  const followedSources = useDiscoverStore((s) => s.followedSources);
  const followedTopics = useDiscoverStore((s) => s.followedTopics);
  const customFeeds = useDiscoverStore((s) => s.customFeeds);
  const hiddenSources = useDiscoverStore((s) => s.hiddenSources);
  const saved = useDiscoverStore((s) => s.saved);
  const slots = useFeedStore((s) => s.slots);
  const pending = useFeedStore((s) => s.pending);
  const error = useFeedStore((s) => s.error);
  const load = useFeedStore((s) => s.load);

  const feeds = useMemo(
    () => feedsForView(view, { followedSources, followedTopics, customFeeds, hiddenSources }),
    [view, followedSources, followedTopics, customFeeds, hiddenSources],
  );
  const feedsKey = feeds.map((f) => f.url).join('\n');

  // biome-ignore lint/correctness/useExhaustiveDependencies: `feedsKey` is the content of `feeds`; the array identity changes more often than that
  useEffect(() => {
    if (feeds.length) void load(feeds);
  }, [feedsKey, load]);

  useEffect(() => {
    if (!feeds.length) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void load(feeds, { force: true });
    };
    const t = window.setInterval(refresh, AUTO_REFRESH_MS);
    return () => window.clearInterval(t);
  }, [feeds, load]);

  const entries = useMemo(() => {
    if (view === 'saved') return [...saved].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt)).map(savedToEntry);
    return rankEntries(feeds.flatMap((f) => toEntries(f, slots[f.url]?.items ?? [])));
  }, [view, saved, feeds, slots]);

  const updatedAt = useMemo(() => {
    const times = feeds.map((f) => slots[f.url]?.at ?? 0).filter((t) => t > 0);
    return times.length ? Math.max(...times) : null;
  }, [feeds, slots]);

  const failed = useMemo(() => feeds.filter((f) => slots[f.url]?.error && !slots[f.url]?.items.length), [feeds, slots]);

  return {
    feeds,
    entries,
    failed,
    loading: pending > 0 && view !== 'saved',
    error,
    updatedAt,
    refresh: () => void load(feeds, { force: true }),
  };
}

/** Find the full article (with its body) for an id: this view's list first, then anything loaded, then the reading list. */
export function useArticleById(id: string | null, entries: readonly Entry[]): Entry | null {
  const slots = useFeedStore((s) => s.slots);
  const saved = useDiscoverStore((s) => s.saved);
  const customFeeds = useDiscoverStore((s) => s.customFeeds);
  return useMemo(() => {
    if (!id) return null;
    const live = findLive(id, slots, customFeeds);
    const inView = entries.find((e) => e.id === id);
    if (inView) return inView.contentHtml || !live ? inView : { ...inView, contentHtml: live.contentHtml };
    if (live) return live;
    const s = saved.find((x) => x.id === id);
    return s ? savedToEntry(s) : null;
  }, [id, entries, slots, saved, customFeeds]);
}

function findLive(id: string, slots: SlotMap, customFeeds: readonly CustomFeed[]): Entry | null {
  const refs = new Map<string, FeedRef>([...CATALOG.map(refOfSource), ...customFeeds.map(refOfCustom)].map((r) => [r.url, r]));
  for (const [url, slot] of Object.entries(slots)) {
    const a = slot.items.find((x) => x.id === id);
    const ref = refs.get(url);
    if (a && ref) return toEntries(ref, [a])[0] ?? null;
  }
  return null;
}
