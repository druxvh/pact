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
  /** Optional identity: `upsert` keeps one entry per key (e.g. one per chat channel, whose count keeps growing). */
  key?: string;
  /** Where clicking the notification should take you. */
  link?: { section: Section; sub?: string | null };
};

type NewNotification = Omit<Notification, 'id' | 'createdAt' | 'read'> & Partial<Pick<Notification, 'read'>>;

type State = {
  notifications: Notification[];
  add: (n: NewNotification) => string;
  /** Add, or replace (and bring to the top, unread) the entry that has this `key`. */
  upsert: (key: string, n: NewNotification) => string;
  /** Mark read every entry whose key starts with `keyPrefix`. */
  markReadByKey: (keyPrefix: string) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
};

const MAX = 50;

export const useNotificationStore = create<State>()(
  persist(
    (set, get) => ({
      notifications: [],
      add: (n) => {
        const id = uid('n');
        set((s) => ({
          notifications: [{ id, createdAt: new Date().toISOString(), read: false, ...n }, ...s.notifications].slice(0, MAX),
        }));
        return id;
      },
      upsert: (key, n) => {
        const id = get().notifications.find((x) => x.key === key)?.id ?? uid('n');
        set((s) => ({
          notifications: [{ id, createdAt: new Date().toISOString(), read: false, ...n, key }, ...s.notifications.filter((x) => x.key !== key)].slice(0, MAX),
        }));
        return id;
      },
      markReadByKey: (keyPrefix) =>
        set((s) => ({ notifications: s.notifications.map((x) => (!x.read && x.key?.startsWith(keyPrefix) ? { ...x, read: true } : x)) })),
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
