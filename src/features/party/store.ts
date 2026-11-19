import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isValidRoomCode, normalizeRoomCode } from '@/features/party/roomCode';
import { syncAcrossTabs } from '@/lib/persist';

export type RecentRoom = { code: string; at: number };

const MAX_RECENT = 6;

type PartyState = {
  /** Name shown in parties. Empty = use your pact profile name. */
  name: string;
  recent: RecentRoom[];
  setName: (name: string) => void;
  /** Move (or add) a room to the top of the recent list. */
  remember: (code: string) => void;
  forget: (code: string) => void;
  clearRecent: () => void;
};

export const usePartyStore = create<PartyState>()(
  persist(
    (set) => ({
      name: '',
      recent: [],
      setName: (name) => set({ name: name.slice(0, 24) }),
      remember: (raw) => {
        const code = normalizeRoomCode(raw);
        if (!isValidRoomCode(code)) return;
        set((s) => ({ recent: [{ code, at: Date.now() }, ...s.recent.filter((r) => r.code !== code)].slice(0, MAX_RECENT) }));
      },
      forget: (code) => set((s) => ({ recent: s.recent.filter((r) => r.code !== code) })),
      clearRecent: () => set({ recent: [] }),
    }),
    { name: 'pact-party', version: 1 },
  ),
);

syncAcrossTabs('pact-party', usePartyStore);
