import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { syncAcrossTabs } from '@/lib/persist';
import { isTopicId, SOURCE_BY_ID, STARTER_SOURCES, type TopicId } from './catalog';
import { addRead, addSaved, CUSTOM_FEED_CAP, type DiscoverData, FOLLOW_CAP, feedIdFor, removeSaved, sanitizeDiscoverData, toSaved } from './logic';
import type { CustomFeed, Density, Entry, SavedArticle, View } from './types';

/** Persisted data (and what a backup carries). The fetched articles are not here: they live in the cache (`cache.ts`). */
export const DISCOVER_KEY = 'pact-discover';

type DiscoverState = DiscoverData & {
  followSource: (id: string) => void;
  unfollowSource: (id: string) => void;
  toggleTopic: (topic: TopicId) => void;
  /** Add (and follow) a feed by address. Returns its id, or null when the cap is reached. */
  addCustomFeed: (url: string, name: string) => string | null;
  removeCustomFeed: (id: string) => void;
  hideSource: (id: string) => void;
  unhideSource: (id: string) => void;
  toggleSaved: (entry: Entry | SavedArticle, now?: string) => boolean;
  unsave: (id: string) => void;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  setDensity: (d: Density) => void;
  setView: (v: View) => void;
};

const initialData = (): DiscoverData => ({
  followedSources: [...STARTER_SOURCES],
  followedTopics: [],
  customFeeds: [],
  hiddenSources: [],
  saved: [],
  read: [],
  density: 'grid',
  topic: 'foryou',
});

const DATA_KEYS = ['followedSources', 'followedTopics', 'customFeeds', 'hiddenSources', 'saved', 'read', 'density', 'topic'] as const;

export const useDiscoverStore = create<DiscoverState>()(
  persist(
    (set, get) => ({
      ...initialData(),

      followSource: (id) => {
        const s = get();
        if (s.followedSources.includes(id) || s.followedSources.length >= FOLLOW_CAP) return;
        if (!SOURCE_BY_ID[id] && !s.customFeeds.some((c) => c.id === id)) return;
        set({ followedSources: [...s.followedSources, id] });
      },
      unfollowSource: (id) => set((s) => ({ followedSources: s.followedSources.filter((x) => x !== id) })),
      toggleTopic: (topic) =>
        set((s) => ({
          followedTopics: s.followedTopics.includes(topic)
            ? s.followedTopics.filter((t) => t !== topic)
            : isTopicId(topic)
              ? [...s.followedTopics, topic]
              : s.followedTopics,
        })),

      addCustomFeed: (url, name) => {
        const s = get();
        const id = feedIdFor(url);
        const existing = s.customFeeds.find((c) => c.id === id || c.url === url);
        if (existing) {
          if (!s.followedSources.includes(existing.id)) set({ followedSources: [...s.followedSources, existing.id] });
          return existing.id;
        }
        if (s.customFeeds.length >= CUSTOM_FEED_CAP) return null;
        const feed: CustomFeed = { id, url, name: name.trim().slice(0, 60) || new URL(url).hostname.replace(/^www\./, ''), addedAt: new Date().toISOString() };
        set({ customFeeds: [...s.customFeeds, feed], followedSources: [...s.followedSources, id] });
        return id;
      },
      removeCustomFeed: (id) =>
        set((s) => ({
          customFeeds: s.customFeeds.filter((c) => c.id !== id),
          followedSources: s.followedSources.filter((x) => x !== id),
          hiddenSources: s.hiddenSources.filter((x) => x !== id),
        })),

      hideSource: (id) => set((s) => (s.hiddenSources.includes(id) ? s : { hiddenSources: [...s.hiddenSources, id] })),
      unhideSource: (id) => set((s) => ({ hiddenSources: s.hiddenSources.filter((x) => x !== id) })),

      toggleSaved: (entry, now) => {
        const s = get();
        if (s.saved.some((x) => x.id === entry.id)) {
          set({ saved: removeSaved(s.saved, entry.id) });
          return false;
        }
        set({ saved: addSaved(s.saved, toSaved(entry, now)) });
        return true;
      },
      unsave: (id) => set((s) => ({ saved: removeSaved(s.saved, id) })),

      markRead: (id) => set((s) => (s.read[0] === id ? s : { read: addRead(s.read, id) })),
      markUnread: (id) => set((s) => ({ read: s.read.filter((x) => x !== id) })),

      setDensity: (density) => set({ density }),
      setView: (topic) => set({ topic }),
    }),
    {
      name: DISCOVER_KEY,
      version: 1,
      partialize: (s) => Object.fromEntries(DATA_KEYS.map((k) => [k, s[k]])) as DiscoverData,
      // Whatever is on disk (or came from a backup) is coerced field by field; a missing field keeps its default.
      merge: (persisted, current) => ({ ...current, ...sanitizeDiscoverData(persisted) }),
    },
  ),
);

syncAcrossTabs(DISCOVER_KEY, useDiscoverStore);
