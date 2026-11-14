import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { uid } from '@/lib/format';
import { syncAcrossTabs } from '@/lib/persist';
import type { Section } from '@/store/useNavStore';

export type NotificationKind = 'friend' | 'chat' | 'system' | 'space' | 'timer';

export type Notification = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  kind?: NotificationKind;
  /** Where clicking the notification should take you. */
  link?: { section: Section; sub?: string | null };
};

type NewNotification = Omit<Notification, 'id' | 'createdAt' | 'read'> & Partial<Pick<Notification, 'read'>>;

type State = {
  notifications: Notification[];
  add: (n: NewNotification) => string;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
};

const MAX = 50;

export const useNotificationStore = create<State>()(
  persist(
    (set) => ({
      notifications: [],
      add: (n) => {
        const id = uid('n');
        set((s) => ({
          notifications: [{ id, createdAt: new Date().toISOString(), read: false, ...n }, ...s.notifications].slice(0, MAX),
        }));
        return id;
      },
      markRead: (id) => set((s) => ({ notifications: s.notifications.map((x) => (x.id === id ? { ...x, read: true } : x)) })),
      markAllRead: () => set((s) => ({ notifications: s.notifications.map((x) => (x.read ? x : { ...x, read: true })) })),
      dismiss: (id) => set((s) => ({ notifications: s.notifications.filter((x) => x.id !== id) })),
      clearAll: () => set({ notifications: [] }),
    }),
    { name: 'pact-notifications', version: 2 },
  ),
);

syncAcrossTabs('pact-notifications', useNotificationStore);

export const selectUnreadCount = (s: State) => s.notifications.reduce((n, x) => n + (x.read ? 0 : 1), 0);
