import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Notification = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  kind?: 'friend' | 'chat' | 'system' | 'space';
};

type State = {
  notifications: Notification[];
  add: (n: Omit<Notification, 'id' | 'createdAt' | 'read'> & Partial<Pick<Notification, 'read'>>) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
};

const seed: Notification[] = [
  { id: 'n1', title: 'Alex sent a message', body: 'hey — pact is live ✨', createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(), read: false, kind: 'chat' },
  { id: 'n2', title: 'Friend request', body: 'Jordan wants to connect', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(), read: false, kind: 'friend' },
  { id: 'n3', title: 'Space invite', body: 'You were invited to “design jam”', createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), read: true, kind: 'space' },
];

export const useNotificationStore = create<State>()(
  persist(
    (set) => ({
      notifications: seed,
      add: (n) =>
        set((s) => ({
          notifications: [
            { id: crypto.randomUUID(), createdAt: new Date().toISOString(), read: false, ...n },
            ...s.notifications,
          ].slice(0, 20),
        })),
      markAllRead: () => set((s) => ({ notifications: s.notifications.map((x) => ({ ...x, read: true })) })),
      dismiss: (id) => set((s) => ({ notifications: s.notifications.filter((x) => x.id !== id) })),
    }),
    { name: 'pact-notifications' },
  ),
);
