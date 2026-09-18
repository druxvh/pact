import { create } from 'zustand';
import type { ChatMessage, OfficeUser } from '@/types/user';

type UserState = {
  currentUser: OfficeUser | null;
  teammates: OfficeUser[];
  messages: ChatMessage[];
  setCurrentUser: (user: OfficeUser | null) => void;
};

export const useUserStore = create<UserState>((set) => ({
  currentUser: {
    id: 'local-user',
    displayName: 'You',
    isOnline: true,
  },
  teammates: [
    { id: 'alex', displayName: 'Alex', isOnline: true },
    { id: 'jordan', displayName: 'Jordan', isOnline: true },
    { id: 'sam', displayName: 'Sam', isOnline: false },
  ],
  messages: [
    {
      id: 'msg-1',
      userId: 'alex',
      body: 'Standup in 10 — lobby is open.',
      createdAt: new Date().toISOString(),
    },
  ],
  setCurrentUser: (user) => set({ currentUser: user }),
}));
