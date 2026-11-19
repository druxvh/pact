/**
 * Who someone is, for the Activity UI: a name and a picture for an account id (or a simulated person's id).
 *
 * Order of lookup: me → the simulated people (`useUserStore`) → what the Communities store already loaded → one batched lookup of
 * the profile (people who share a community with me are readable; anyone else stays "Someone" — their note is still shown).
 * Everything is cleaned again before it is shown.
 */
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { getCommunityApi, useCommunityStore } from '@/features/community/useCommunityStore';
import { isUserId } from '@/features/nowplaying/api';
import { cleanText } from '@/features/nowplaying/track';
import { useAuthStore } from '@/store/useAuthStore';
import { ME_ID, useUserStore } from '@/store/useUserStore';

export type PersonInfo = { id: string; name: string; username?: string; avatarUrl?: string; known: boolean };
type Cached = { name: string; username?: string; avatarUrl?: string };

type PeopleState = {
  people: Record<string, Cached>;
  /** Accounts we asked about and could not read (a stranger's profile is not readable): their name stays unknown. */
  failed: Record<string, true>;
  /** Look these accounts up (batched, once each). Never throws. */
  ensure(ids: readonly string[]): void;
  /** Look them up now and wait for the answer. Never throws. */
  load(ids: readonly string[]): Promise<void>;
  reset(): void;
};

const BATCH_MS = 40;
const asked = new Set<string>();
let queue = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

export const usePeopleStore = create<PeopleState>((set, get) => ({
  people: {},
  failed: {},

  async load(ids) {
    const batch = [...new Set(ids)].filter((id) => isUserId(id) && !get().people[id]).slice(0, 100);
    if (batch.length === 0) return;
    for (const id of batch) asked.add(id);
    try {
      const found = await getCommunityApi().getProfiles(batch);
      const got = new Set(found.map((p) => p.id));
      set((s) => ({
        people: {
          ...s.people,
          ...Object.fromEntries(
            found.map((p) => [
              p.id,
              { name: cleanText(p.displayName || p.username, 60), username: cleanText(p.username, 30) || undefined, avatarUrl: p.avatarUrl },
            ]),
          ),
        },
        failed: { ...s.failed, ...Object.fromEntries(batch.filter((id) => !got.has(id)).map((id) => [id, true as const])) },
      }));
    } catch {
      /* not allowed to read them, or offline: they stay "Someone" */
      set((s) => ({ failed: { ...s.failed, ...Object.fromEntries(batch.map((id) => [id, true as const])) } }));
    }
  },

  ensure(ids) {
    for (const id of ids) if (isUserId(id) && !asked.has(id) && !get().people[id]) queue.add(id);
    if (queue.size === 0 || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      const batch = [...queue].slice(0, 100);
      queue = new Set([...queue].slice(100));
      void get().load(batch);
      if (queue.size > 0) get().ensure([]);
    }, BATCH_MS);
  },

  reset() {
    asked.clear();
    queue = new Set();
    set({ people: {}, failed: {} });
  },
}));

/** My own account id (the signed-in user), or null. */
export const myAccountId = (): string | null => useAuthStore.getState().user?.id ?? null;

/** The local "me" has two ids: `ME_ID` in the simulated parts of the app, the account id in everything real. Real ones win. */
export const canonicalId = (id: string | null | undefined): string | null => (id === ME_ID ? myAccountId() : (id ?? null));

type Sources = {
  myId: string | null;
  me: { displayName: string; username: string; avatarUrl?: string };
  teammates: ReadonlyArray<{ id: string; displayName: string; username: string; avatarUrl?: string }>;
  community: Record<string, { displayName: string; username: string; avatarUrl?: string } | undefined>;
  cached: Record<string, Cached>;
};

function resolve(id: string, s: Sources): PersonInfo {
  if (id === ME_ID || id === s.myId) {
    return { id, name: cleanText(s.me.displayName, 60) || 'You', username: s.me.username, avatarUrl: s.me.avatarUrl, known: true };
  }
  const demo = s.teammates.find((t) => t.id === id);
  if (demo) return { id, name: demo.displayName || demo.username, username: demo.username, avatarUrl: demo.avatarUrl, known: true };
  const c = s.community[id];
  if (c) return { id, name: cleanText(c.displayName || c.username, 60) || 'Someone', username: c.username, avatarUrl: c.avatarUrl, known: true };
  const cached = s.cached[id];
  return cached ? { id, ...cached, known: true } : { id, name: 'Someone', known: false };
}

/** Resolve without subscribing (for notices and tests). */
export function personInfo(id: string): PersonInfo {
  const user = useUserStore.getState();
  return resolve(id, {
    myId: myAccountId(),
    me: user.currentUser,
    teammates: user.teammates,
    community: useCommunityStore.getState().profiles,
    cached: usePeopleStore.getState().people,
  });
}

/** Hook form: re-renders when the lookup lands (it listens to this person's entries only, not to every profile). */
export function usePerson(id: string | null | undefined): PersonInfo {
  const key = id ?? '';
  const cached = usePeopleStore((s) => s.people[key]);
  const community = useCommunityStore((s) => s.profiles[key]);
  const me = useUserStore((s) => s.currentUser);
  const teammates = useUserStore((s) => s.teammates);
  const myId = useAuthStore((s) => s.user?.id ?? null);
  useEffect(() => {
    if (key) usePeopleStore.getState().ensure([key]);
  }, [key]);
  if (!key) return { id: '', name: 'Someone', known: false };
  return resolve(key, { myId, me, teammates, community: community ? { [key]: community } : {}, cached: cached ? { [key]: cached } : {} });
}

/**
 * Which of these accounts can be named — me, a simulated friend, someone whose profile we may read — and whether lookups are still
 * on their way. A note from someone we can't name (a stranger who shows notes to "everyone": their profile isn't readable) is not
 * shown by the feed: no "Unknown" cards.
 */
export function useResolvedOwners(ids: readonly string[]): { known: ReadonlySet<string>; pending: boolean } {
  const cached = usePeopleStore((s) => s.people);
  const failed = usePeopleStore((s) => s.failed);
  const community = useCommunityStore((s) => s.profiles);
  const me = useUserStore((s) => s.currentUser);
  const teammates = useUserStore((s) => s.teammates);
  const myId = useAuthStore((s) => s.user?.id ?? null);
  // a stable list (re-created only when the set of ids changes), so callers can pass a fresh array every render
  const key = [...new Set(ids)].sort().join(',');
  const list = useMemo(() => (key ? key.split(',') : []), [key]);
  useEffect(() => {
    usePeopleStore.getState().ensure(list);
  }, [list]);
  return useMemo(() => {
    const known = new Set<string>();
    let pending = false;
    for (const id of list) {
      if (resolve(id, { myId, me, teammates, community, cached }).known) known.add(id);
      else if (isUserId(id) && !failed[id]) pending = true;
    }
    return { known, pending };
  }, [list, cached, failed, community, me, teammates, myId]);
}
