import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { forgetUsage, recordUsage, togglePinned } from '@/lib/omnibox/frecency';
import type { UsageEntry } from '@/lib/omnibox/types';
import { syncAcrossTabs } from '@/lib/persist';

type OmniState = {
  entries: Record<string, UsageEntry>;
  pinned: string[];
  /** The user picked something: remember it, so it ranks higher next time. */
  record: (key: string) => void;
  forget: (key: string) => void;
  togglePin: (key: string) => void;
  clear: () => void;
};

/** What you pick and pin in the omnibox. Small (capped at ~160 keys), on this device only. */
export const useOmniStore = create<OmniState>()(
  persist(
    (set) => ({
      entries: {},
      pinned: [],
      record: (key) => set((s) => recordUsage(s, key)),
      forget: (key) => set((s) => forgetUsage(s, key)),
      togglePin: (key) => set((s) => togglePinned(s, key)),
      clear: () => set({ entries: {}, pinned: [] }),
    }),
    { name: 'pact-omnibox', version: 1 },
  ),
);

syncAcrossTabs('pact-omnibox', useOmniStore);
