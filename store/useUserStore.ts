import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage, OfficeUser, FriendRequest } from '@/types/user';
import type { Space } from '@/types/space';

type UserState = {
  currentUser: OfficeUser | null;
  teammates: OfficeUser[];
  messages: ChatMessage[];
  friendRequests: FriendRequest[];
  spaces: Space[];
  setCurrentUser: (user: OfficeUser | null) => void;
  updateProfile: (patch: Partial<OfficeUser>) => void;
  sendFriendRequest: (username: string) => { ok: boolean; msg: string };
  acceptRequest: (id: string) => void;
  createSpace: (name: string, memberUsernames: string[]) => void;
};

const now = () => new Date().toISOString();

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      currentUser: {
        id: 'local-user',
        displayName: 'You',
        username: 'you',
        designation: 'Builder',
        bio: 'Building pact — fun, black, community.',
        email: 'you@pact.app',
        isOnline: true,
      },
      teammates: [
        { id: 'alex', displayName: 'Alex', username: 'alex', designation: 'Designer', bio: 'loves black UIs', isOnline: true },
        { id: 'jordan', displayName: 'Jordan', username: 'jordan', designation: 'PM', bio: 'ships fast', isOnline: true },
        { id: 'sam', displayName: 'Sam', username: 'sam', designation: 'Eng', bio: 'infra wizard', isOnline: false },
        { id: 'riley', displayName: 'Riley', username: 'riley', designation: 'Writer', bio: 'words & vibes', isOnline: true },
      ],
      messages: [
        { id: 'msg-1', userId: 'alex', body: 'Standup in 10 — lobby is open.', createdAt: now() },
      ],
      friendRequests: [
        { id: 'fr1', fromId: 'jordan', toId: 'local-user', status: 'pending', createdAt: now() },
      ],
      spaces: [
        { id: 'space-1', name: 'design jam', memberIds: ['local-user', 'alex', 'jordan'], description: 'Shared kanban + notes + chat', createdAt: now() },
      ],
      setCurrentUser: (user) => set({ currentUser: user }),
      updateProfile: (patch) =>
        set((s) => ({
          currentUser: s.currentUser ? { ...s.currentUser, ...patch } : s.currentUser,
        })),
      sendFriendRequest: (username) => {
        const clean = username.replace(/^@/, '').trim().toLowerCase();
        if (!clean) return { ok: false, msg: 'Enter a username' };
        const { teammates, currentUser } = get();
        if (clean === currentUser?.username) return { ok: false, msg: "That’s you 🙂" };
        const target = teammates.find((t) => t.username.toLowerCase() === clean);
        if (!target) return { ok: false, msg: `No user @${clean} found (mock: try alex/jordan/sam/riley)` };
        // mock pending
        const req: FriendRequest = { id: crypto.randomUUID(), fromId: 'local-user', toId: target.id, status: 'pending', createdAt: now() };
        set((s) => ({ friendRequests: [req, ...s.friendRequests] }));
        return { ok: true, msg: `Request sent to @${clean}` };
      },
      acceptRequest: (id) =>
        set((s) => ({
          friendRequests: s.friendRequests.map((r) => (r.id === id ? { ...r, status: 'accepted' } : r)),
        })),
      createSpace: (name, memberUsernames) =>
        set((s) => {
          const ids = memberUsernames
            .map((u) => s.teammates.find((t) => t.username.toLowerCase() === u.toLowerCase())?.id)
            .filter(Boolean) as string[];
          const space: Space = {
            id: crypto.randomUUID(),
            name: name.trim() || 'Untitled space',
            memberIds: ['local-user', ...ids],
            createdAt: now(),
          };
          return { spaces: [space, ...s.spaces] };
        }),
    }),
    { name: 'pact-user' },
  ),
);
