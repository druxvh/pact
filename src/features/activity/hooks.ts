import { useEffect, useMemo } from 'react';
import { getCommunityApi } from '@/features/community/useCommunityStore';
import { isUserId } from '@/features/nowplaying/api';
import { useLocalNowStore } from '@/features/nowplaying/localNow';
import { notify } from '@/lib/toast';
import { useAuthStore } from '@/store/useAuthStore';
import { useNavStore } from '@/store/useNavStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import type { ActivityApi } from './api';
import { demoActivityApi } from './demo';
import { buildThreads, type Thread, unreadTotal } from './describe';
import { canonicalId, personInfo, usePeopleStore } from './people';
import { type ActivitySink, createActivityStore } from './store';
import { activityApiFor } from './supabaseApi';
import { ActivityError, type Engagement, NO_ENGAGEMENT, type Note, refKey, type SubjectRef } from './types';

/** Test / dev-harness override. Production never sets this. */
let override: ActivityApi | null = null;
export const setActivityApiForTesting = (api: ActivityApi | null) => {
  override = api;
};

/** The data layer for whoever is signed in, or null for a guest (a guest has no activity of their own). */
export function getActivityApi(): ActivityApi | null {
  if (override) return override;
  const user = useAuthStore.getState().user;
  return user ? activityApiFor(user.id) : null;
}

/** Like `getActivityApi`, but rejects when there is no account — for the writes that need one. */
export function requireActivityApi(): ActivityApi {
  const api = getActivityApi();
  if (!api) throw new ActivityError('not_signed_in');
  return api;
}

/** A person's name for a notice: what we know, or one lookup of their profile. */
async function nameOf(id: string): Promise<string> {
  if (!personInfo(id).known) await usePeopleStore.getState().load([id]);
  return personInfo(id).name;
}

/** The people in my communities — who the Home feed is about. */
async function peersOf(): Promise<string[]> {
  const api = getCommunityApi();
  const communities = await api.listCommunities();
  const lists = await Promise.all(communities.slice(0, 12).map((c) => api.listMembers(c.id).catch(() => [])));
  const mine = api.me;
  return [...new Set(lists.flat().map((m) => m.userId))].filter((id) => id !== mine && isUserId(id)).slice(0, 200);
}

/** The app's notification centre and toasts, as the activity store sees them. */
const sink: ActivitySink = {
  notice: (n) => useNotificationStore.getState().upsert(n.key, { title: n.title, body: n.body, kind: 'chat', link: { section: 'chat', sub: n.sub } }),
  resolve: (prefix) => useNotificationStore.getState().markReadByKey(prefix),
  toast: ({ title, body, sub }) => notify.action(title, 'Open', () => useNavStore.getState().go('chat', sub), body),
};

/** Everyone's notes, hearts, comments and activity messages (see store.ts). */
export const useActivityStore = createActivityStore(getActivityApi, { demo: demoActivityApi, names: nameOf, peers: peersOf, sink });

const myId = (s: { user: { id: string } | null }) => s.user?.id ?? null;

/**
 * Keep activity live for the whole signed-in app (mount once, in AppShell): messages arrive in the bell and as an unread badge, my
 * note is known, expired notes are dropped. Starts on sign-in; stops and forgets everything on sign-out or when another account signs in.
 * Also remembers the songs this browser plays (this session only) so one can be picked for a note.
 */
export function useActivityBackground(): void {
  const userId = useAuthStore((s) => (s.status === 'signedIn' ? myId(s) : null));
  useEffect(() => {
    const store = useActivityStore.getState();
    store.reset();
    usePeopleStore.getState().reset();
    if (userId) void store.start();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const note = () => {
      const local = useLocalNowStore.getState().now;
      if (local?.playing) useActivityStore.getState().noteRecent(local.track);
    };
    note();
    return useLocalNowStore.subscribe(note);
  }, [userId]);
}

/**
 * The current note of `userId` (null when none, or when it has expired). Registers interest while mounted, so the feed — the one
 * place notes of other people come from — is loaded once for the whole page, not once per avatar. Accepts the simulated "me".
 */
export function useNote(userId: string | null | undefined): Note | null {
  const id = canonicalId(userId);
  const note = useActivityStore((s) => (id ? s.notes[id] : undefined));
  useEffect(() => (id ? useActivityStore.getState().watchNote(id) : undefined), [id]);
  return note && Date.parse(note.expiresAt) > Date.now() ? note : null;
}

/** Hearts and comment counts of a subject; `NO_ENGAGEMENT` until fetched. Registers interest while mounted (batched, cached). */
export function useEngagement(ref: SubjectRef | null): Engagement {
  const k = ref ? refKey(ref) : '';
  const e = useActivityStore((s) => (k ? s.engagement[k] : undefined));
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key identifies the subject
  useEffect(() => (ref ? useActivityStore.getState().watchEngagement(ref) : undefined), [k]);
  return e ?? NO_ENGAGEMENT;
}

/** The signed-in account's id, or null. */
export const useMyId = (): string | null => useAuthStore(myId);

/** Unread activity messages (for the Chat badge). */
export function useUnreadActivity(): number {
  const me = useMyId();
  return useActivityStore((s) => (me ? unreadTotal(s.messages, me) : 0));
}

/** One thread per person, most recent first. */
export function useThreads(): Thread[] {
  const me = useMyId();
  const messages = useActivityStore((s) => s.messages);
  return useMemo(() => (me ? buildThreads(messages, me) : []), [messages, me]);
}
