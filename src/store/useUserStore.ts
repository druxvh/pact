import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { uid } from '@/lib/format';
import { syncAcrossTabs } from '@/lib/persist';
import type { FriendRequest, Person } from '@/types/user';

/** The signed-in (local) user's id. Stable so existing persisted data keeps working. */
export const ME_ID = 'local-user';

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** `@Alex ` → `alex` */
export function normalizeUsername(raw: string): string {
  // trim FIRST — otherwise a leading space stops the `^@` from matching
  return raw.trim().replace(/^@+/, '').trim().toLowerCase();
}

/** Returns an error message, or null when the username is valid. */
export function validateUsername(raw: string): string | null {
  const v = normalizeUsername(raw);
  if (v.length < 3) return 'At least 3 characters';
  if (v.length > 20) return 'At most 20 characters';
  if (!USERNAME_RE.test(v)) return 'Letters, numbers and underscores only';
  return null;
}

const DEFAULT_ME: Person = {
  id: ME_ID,
  displayName: 'You',
  username: 'you',
  designation: '',
  bio: '',
  email: '',
  isOnline: true,
};

/**
 * Simulated community directory. Until a real backend exists these are the only
 * users you can find by username — they respond locally (see store/demoServer).
 */
export const DEMO_DIRECTORY: Person[] = [
  { id: 'alex', displayName: 'Alex Rivera', username: 'alex', designation: 'Product Designer', bio: 'Pixels, motion & black UIs.', isOnline: true },
  { id: 'jordan', displayName: 'Jordan Lee', username: 'jordan', designation: 'Product Manager', bio: 'Ships fast, writes docs.', isOnline: true },
  { id: 'sam', displayName: 'Sam Okafor', username: 'sam', designation: 'Engineer', bio: 'Infra wizard.', isOnline: false },
  { id: 'riley', displayName: 'Riley Chen', username: 'riley', designation: 'Writer', bio: 'Words & vibes.', isOnline: true },
];

export type FriendResult = {
  ok: boolean;
  msg: string;
  requestId?: string;
  personId?: string;
  /** True when this call accepted a request the other person had already sent. */
  accepted?: boolean;
};

type UserState = {
  currentUser: Person;
  /** Directory of other people you can find/add. */
  teammates: Person[];
  friendIds: string[];
  friendRequests: FriendRequest[];
  onboarded: boolean;
  updateProfile: (patch: Partial<Person>) => void;
  completeOnboarding: (patch: Partial<Person>) => void;
  sendFriendRequest: (username: string) => FriendResult;
  acceptRequest: (id: string) => void;
  rejectRequest: (id: string) => void;
};

const now = () => new Date().toISOString();

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      currentUser: DEFAULT_ME,
      teammates: DEMO_DIRECTORY,
      friendIds: [],
      friendRequests: [],
      onboarded: false,

      updateProfile: (patch) => set((s) => ({ currentUser: { ...s.currentUser, ...patch, id: ME_ID } })),

      completeOnboarding: (patch) =>
        set((s) => ({ currentUser: { ...s.currentUser, ...patch, id: ME_ID }, onboarded: true })),

      sendFriendRequest: (rawUsername) => {
        const clean = normalizeUsername(rawUsername);
        if (!clean) return { ok: false, msg: 'Enter a username' };
        const { teammates, currentUser, friendIds, friendRequests } = get();
        if (clean === currentUser.username) return { ok: false, msg: "That's you 🙂" };
        const target = teammates.find((t) => t.username.toLowerCase() === clean);
        if (!target) return { ok: false, msg: `No one called @${clean} in the demo directory` };
        if (friendIds.includes(target.id)) return { ok: false, msg: `You're already friends with @${target.username}` };
        if (friendRequests.some((r) => r.status === 'pending' && r.fromId === ME_ID && r.toId === target.id)) {
          return { ok: false, msg: `Request to @${target.username} is already pending` };
        }
        // They already asked us — treat it as accepting.
        const incoming = friendRequests.find((r) => r.status === 'pending' && r.fromId === target.id && r.toId === ME_ID);
        if (incoming) {
          get().acceptRequest(incoming.id);
          return { ok: true, msg: `You and @${target.username} are now friends`, personId: target.id, accepted: true };
        }
        const req: FriendRequest = { id: uid('fr'), fromId: ME_ID, toId: target.id, status: 'pending', createdAt: now() };
        set((s) => ({ friendRequests: [req, ...s.friendRequests] }));
        return { ok: true, msg: `Request sent to @${target.username}`, requestId: req.id, personId: target.id };
      },

      acceptRequest: (id) =>
        set((s) => {
          const req = s.friendRequests.find((r) => r.id === id);
          if (!req || req.status !== 'pending') return s;
          const other = req.fromId === ME_ID ? req.toId : req.fromId;
          return {
            friendRequests: s.friendRequests.map((r) => (r.id === id ? { ...r, status: 'accepted' as const } : r)),
            friendIds: s.friendIds.includes(other) ? s.friendIds : [...s.friendIds, other],
          };
        }),

      rejectRequest: (id) =>
        set((s) => ({
          friendRequests: s.friendRequests.map((r) => (r.id === id ? { ...r, status: 'rejected' as const } : r)),
        })),
    }),
    {
      name: 'pact-user',
      version: 4,
      migrate: (persisted) => {
        // Older versions shipped a seeded "You" profile, a static teammate list, a dead `messages` array and
        // "spaces" (replaced by notebooks/boards/group chats). Rebuilding the object here drops all of that.
        const p = (persisted ?? {}) as Partial<UserState>;
        const reqs = p.friendRequests ?? [];
        return {
          currentUser: p.currentUser ?? DEFAULT_ME,
          teammates: DEMO_DIRECTORY,
          friendRequests: reqs,
          friendIds:
            p.friendIds ??
            reqs.filter((r) => r.status === 'accepted').map((r) => (r.fromId === ME_ID ? r.toId : r.fromId)),
          onboarded: p.onboarded ?? false,
        } as UserState;
      },
    },
  ),
);

syncAcrossTabs('pact-user', useUserStore);

/** Convenience lookup used across features. */
export function findPerson(id: string): Person | undefined {
  const { currentUser, teammates } = useUserStore.getState();
  return id === ME_ID ? currentUser : teammates.find((t) => t.id === id);
}
