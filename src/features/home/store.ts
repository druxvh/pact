import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { uid } from '@/lib/format';
import { syncAcrossTabs } from '@/lib/persist';
import { hostnameOf } from '@/lib/url';

export type Shortcut = { id: string; title: string; url: string };

const STARTERS: Array<Omit<Shortcut, 'id'>> = [
  { title: 'YouTube', url: 'https://www.youtube.com/' },
  { title: 'GitHub', url: 'https://github.com/' },
  { title: 'Gmail', url: 'https://mail.google.com/' },
  { title: 'Calendar', url: 'https://calendar.google.com/' },
  { title: 'Drive', url: 'https://drive.google.com/' },
  { title: 'Notion', url: 'https://www.notion.so/' },
  { title: 'Figma', url: 'https://www.figma.com/' },
  { title: 'Maps', url: 'https://maps.google.com/' },
];

const RECENT_MAX = 6;

type HomeState = {
  pinned: Shortcut[];
  /** Hostnames of most-visited sites the user removed from Home. */
  hiddenHosts: string[];
  recent: string[];
  /** Starter shortcuts have been offered once (so deleting them all stays deleted). */
  seeded: boolean;
  addShortcut: (title: string, url: string) => void;
  updateShortcut: (id: string, patch: Partial<Pick<Shortcut, 'title' | 'url'>>) => void;
  removeShortcut: (id: string) => void;
  hideTopSite: (url: string) => void;
  resetHidden: () => void;
  seedStarters: () => void;
  pushRecent: (q: string) => void;
  removeRecent: (q: string) => void;
  clearRecent: () => void;
};

export const useHomeStore = create<HomeState>()(
  persist(
    (set) => ({
      pinned: [],
      hiddenHosts: [],
      recent: [],
      seeded: false,

      addShortcut: (title, url) => set((s) => ({ pinned: [...s.pinned, { id: uid('sc'), title: title.trim() || hostnameOf(url), url }] })),

      updateShortcut: (id, patch) => set((s) => ({ pinned: s.pinned.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),

      removeShortcut: (id) => set((s) => ({ pinned: s.pinned.filter((p) => p.id !== id) })),

      hideTopSite: (url) =>
        set((s) => {
          const host = hostnameOf(url);
          return s.hiddenHosts.includes(host) ? s : { hiddenHosts: [...s.hiddenHosts, host] };
        }),

      resetHidden: () => set({ hiddenHosts: [] }),

      seedStarters: () => set((s) => (s.seeded ? s : { seeded: true, pinned: STARTERS.map((st) => ({ ...st, id: uid('sc') })) })),

      pushRecent: (q) =>
        set((s) => {
          const v = q.trim();
          if (!v) return s;
          return { recent: [v, ...s.recent.filter((r) => r.toLowerCase() !== v.toLowerCase())].slice(0, RECENT_MAX) };
        }),

      removeRecent: (q) => set((s) => ({ recent: s.recent.filter((r) => r !== q) })),
      clearRecent: () => set({ recent: [] }),
    }),
    { name: 'pact-home', version: 1 },
  ),
);

syncAcrossTabs('pact-home', useHomeStore);
