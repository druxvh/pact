import { useEffect, useMemo } from 'react';
import { notify } from '@/lib/toast';
import { useAuthStore } from '@/store/useAuthStore';
import { useNavStore } from '@/store/useNavStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import type { CommunityApi } from './api';
import { type NotificationSink, totalCommunityUnread } from './notifications';
import { useCommunityPrefs } from './prefs';
import { createCommunityStore } from './store';
import { communityApiFor } from './supabaseApi';
import { CommunityError } from './types';

/** Test / dev-harness override. Production never sets this. */
let override: CommunityApi | null = null;
export const setCommunityApiForTesting = (api: CommunityApi | null) => {
  override = api;
};

/** The data layer for whoever is signed in (components use it directly for things that aren't shared state, like file URLs). */
export function getCommunityApi(): CommunityApi {
  if (override) return override;
  const user = useAuthStore.getState().user;
  if (!user) throw new CommunityError('not_allowed', 'Sign in to use communities.');
  return communityApiFor(user.id);
}

/** The app's notification centre and toasts, as the community store sees them. */
const sink: NotificationSink = {
  upsert: (n) => useNotificationStore.getState().upsert(n.key, { title: n.title, body: n.body, kind: 'chat', link: { section: 'chat', sub: n.sub } }),
  resolve: (prefix) => useNotificationStore.getState().markReadByKey(prefix),
  toast: ({ title, body, sub }) => notify.action(title, 'Open', () => useNavStore.getState().go('chat', sub), body),
};

/** The app's Communities store, bound to whoever is signed in. */
export const useCommunityStore = createCommunityStore(getCommunityApi, { prefs: useCommunityPrefs, sink });

/**
 * Keep community unread counts and notifications live for the whole signed-in app, not just while the Chat tab is open.
 * Mount once (AppShell). Starts on sign-in; tears down and forgets everything on sign-out or when another account signs in.
 */
export function useCommunityBackground(): void {
  const userId = useAuthStore((s) => (s.status === 'signedIn' ? (s.user?.id ?? null) : null));
  useEffect(() => {
    if (!userId) return;
    void useCommunityStore
      .getState()
      .startActivity()
      .catch(() => {});
    return () => useCommunityStore.getState().reset();
  }, [userId]);
}

/** Unread community messages for the Chat nav badge (muted communities excluded). */
export function useCommunityUnreadTotal(): number {
  const unread = useCommunityStore((s) => s.unread);
  const muted = useCommunityPrefs((s) => s.muted);
  return useMemo(() => totalCommunityUnread(unread, muted), [unread, muted]);
}

/** Mute or unmute a community on this device (and mark its existing notification entries read when muting). */
export function setCommunityMuted(communityId: string, muted: boolean): void {
  useCommunityPrefs.getState().setMuted(communityId, muted);
  useCommunityStore.getState().noteMuteChanged(communityId, muted);
}
