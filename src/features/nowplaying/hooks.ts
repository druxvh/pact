import { useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { type NowPlayingApi, NowPlayingError } from './api';
import { createNowPlayingStore } from './store';
import { nowPlayingApiFor } from './supabaseApi';
import type { Track } from './track';

/** Test / dev-harness override. Production never sets this. */
let override: NowPlayingApi | null = null;
export const setNowPlayingApiForTesting = (api: NowPlayingApi | null) => {
  override = api;
};

/** The data layer for whoever is signed in, or null for a guest (a guest has nobody to look at). */
export function getNowPlayingApi(): NowPlayingApi | null {
  if (override) return override;
  const user = useAuthStore.getState().user;
  return user ? nowPlayingApiFor(user.id) : null;
}

/** Like `getNowPlayingApi`, but rejects when there is no account — for the writes that need one. */
export function requireNowPlayingApi(): NowPlayingApi {
  const api = getNowPlayingApi();
  if (!api) throw new NowPlayingError('not_signed_in');
  return api;
}

/** What the people on screen are listening to (see store.ts). */
export const useNowPlayingStore = createNowPlayingStore(getNowPlayingApi);

/**
 * What `userId` is listening to right now (a clean, allow-listed track), or null. Registers interest while the component is mounted,
 * so only the people actually on screen are fetched and followed. Pass nothing for "no one" (a hook can't be conditional).
 */
export function useListening(userId: string | null | undefined): Track | null {
  const row = useNowPlayingStore((s) => (userId ? s.rows[userId] : undefined));
  useEffect(() => (userId ? useNowPlayingStore.getState().watch(userId) : undefined), [userId]);
  return row && row.expiresAt > Date.now() ? row.track : null;
}
