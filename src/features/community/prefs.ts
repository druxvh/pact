import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { syncAcrossTabs } from '@/lib/persist';

/**
 * Per-device community preferences. Muting is deliberately local (not a server setting): a muted community shows no badge,
 * no in-app notification and no toast on this device. The ids are community UUIDs, so another account signing in on the
 * same browser can't collide with them.
 */
export type CommunityPrefs = {
  /** community id → true */
  muted: Record<string, true>;
  setMuted(communityId: string, muted: boolean): void;
};

const KEY = 'pact-community-prefs';

/** A store persisted in localStorage under `persistKey` (tests pass their own key). */
export function createCommunityPrefsStore(persistKey: string = KEY) {
  return create<CommunityPrefs>()(
    persist(
      (set) => ({
        muted: {},
        setMuted: (communityId, muted) =>
          set((s) => {
            if ((s.muted[communityId] === true) === muted) return s;
            const { [communityId]: _was, ...rest } = s.muted;
            return { muted: muted ? { ...rest, [communityId]: true } : rest };
          }),
      }),
      { name: persistKey, version: 1 },
    ),
  );
}
export type PrefsStore = ReturnType<typeof createCommunityPrefsStore>;

export const useCommunityPrefs = createCommunityPrefsStore();
syncAcrossTabs(KEY, useCommunityPrefs);

export const isMuted = (muted: CommunityPrefs['muted'], communityId: string): boolean => muted[communityId] === true;
