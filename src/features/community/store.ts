import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { CommunityApi, TypingChannel } from './api';
import type { Attachment, Channel, Community, CommunityEvent, CommunityMessage, Member, Profile, Reaction } from './types';
import { TYPING_ANNOUNCE_MS, TYPING_TTL_MS, type TypingMap } from './typing';

const PAGE = 50;
const LAST_KEY = 'pact-community-last';

export type CommunityState = {
  ready: boolean;
  loading: boolean;
  error: string | null;
  communities: Community[];
  activeId: string | null;
  activeChannelId: string | null;
  channels: Record<string, Channel[]>;
  members: Record<string, Member[]>;
  /** Oldest → newest. */
  messages: Record<string, CommunityMessage[]>;
  hasMore: Record<string, boolean>;
  reactions: Record<string, Reaction[]>;
  profiles: Record<string, Profile>;
  replyTo: CommunityMessage | null;
  /** Unread messages per channel (only channels that have some). */
  unread: Record<string, { communityId: string; count: number }>;
  /** Who is typing, per channel. Entries expire on their own; readers filter with `activeTypers`. */
  typing: Record<string, TypingMap>;
  /** The person is looking at the newest messages of the open channel (the pane is on screen and scrolled to the bottom). */
  reading: boolean;

  init(): Promise<void>;
  refreshCommunities(): Promise<void>;
  select(communityId: string | null): Promise<void>;
  selectChannel(channelId: string): Promise<void>;
  loadOlder(): Promise<void>;
  send(body: string, attachments: Attachment[]): Promise<void>;
  setReplyTo(m: CommunityMessage | null): void;
  edit(id: string, body: string): Promise<void>;
  remove(id: string): Promise<void>;
  hide(id: string, reason: string): Promise<void>;
  restore(id: string): Promise<void>;
  stripLinks(id: string): Promise<void>;
  toggleReaction(m: CommunityMessage, emoji: string): Promise<void>;
  refreshMembers(): Promise<void>;
  refreshChannels(): Promise<void>;
  refreshUnread(): Promise<void>;
  /** Mark the open channel read up to its newest message (if you are reading the newest and the window is visible). */
  markActiveRead(): void;
  setReading(open: boolean): void;
  /** Tell the others I'm typing in the open channel (rate-limited). */
  announceTyping(): void;
  noteTyping(channelId: string, userId: string): void;
  dispose(): void;
};

/** Total unread in a community (for its badge). */
export const communityUnread = (unread: CommunityState['unread'], communityId: string): number =>
  Object.values(unread).reduce((n, u) => (u.communityId === communityId ? n + u.count : n), 0);

const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

const byTime = (a: CommunityMessage, b: CommunityMessage) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

function upsert(list: CommunityMessage[], m: CommunityMessage): CommunityMessage[] {
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) {
    const next = [...list];
    next[i] = m;
    return next;
  }
  return [...list, m].sort(byTime);
}

/** The Communities state, parameterised over the data layer so it can be tested (and demoed) without a backend. */
export function createCommunityStore(getApi: () => CommunityApi): UseBoundStore<StoreApi<CommunityState>> {
  let unsubscribe: (() => void) | null = null;
  let unsubscribeActivity: (() => void) | null = null;
  let typingChannel: TypingChannel | null = null;
  let lastAnnounce = 0;
  /** channelId → the newest createdAt we've already told the server about, so we don't repeat ourselves. */
  const marked = new Map<string, string>();

  return create<CommunityState>()((set, get) => {
    const api = () => getApi();

    async function ensureProfiles(ids: string[]) {
      const known = get().profiles;
      const missing = [...new Set(ids)].filter((id) => !known[id]);
      if (!missing.length) return;
      const found = await api().getProfiles(missing);
      set((s) => ({ profiles: { ...s.profiles, ...Object.fromEntries(found.map((p) => [p.id, p])) } }));
    }

    async function loadReactions(ids: string[]) {
      if (!ids.length) return;
      const rows = await api().listReactions(ids);
      set((s) => {
        const next = { ...s.reactions };
        for (const id of ids) next[id] = rows.filter((r) => r.messageId === id);
        return { reactions: next };
      });
    }

    function applyEvent(e: CommunityEvent) {
      if (e.type === 'message') {
        const m = e.message;
        set((s) => {
          const typers = s.typing[m.channelId];
          const { [m.authorId]: _gone, ...rest } = typers ?? {};
          return {
            messages: { ...s.messages, [m.channelId]: upsert(s.messages[m.channelId] ?? [], m) },
            replyTo: s.replyTo?.id === m.id ? m : s.replyTo,
            typing: typers && m.authorId in typers ? { ...s.typing, [m.channelId]: rest } : s.typing,
          };
        });
        void ensureProfiles([m.authorId]);
      } else if (e.type === 'reaction-added') {
        set((s) => {
          const cur = s.reactions[e.reaction.messageId] ?? [];
          if (cur.some((r) => r.userId === e.reaction.userId && r.emoji === e.reaction.emoji)) return s;
          return { reactions: { ...s.reactions, [e.reaction.messageId]: [...cur, e.reaction] } };
        });
      } else if (e.type === 'reaction-removed') {
        set((s) => ({
          reactions: {
            ...s.reactions,
            [e.reaction.messageId]: (s.reactions[e.reaction.messageId] ?? []).filter((r) => !(r.userId === e.reaction.userId && r.emoji === e.reaction.emoji)),
          },
        }));
      } else if (e.type === 'members-changed') void get().refreshMembers();
      else void get().refreshChannels();
    }

    const fail = (err: unknown) => {
      set({ error: err instanceof Error ? err.message : 'Something went wrong.', loading: false });
      throw err;
    };

    const patchMessage = (m: CommunityMessage) => set((s) => ({ messages: { ...s.messages, [m.channelId]: upsert(s.messages[m.channelId] ?? [], m) } }));

    return {
      ready: false,
      loading: false,
      error: null,
      communities: [],
      activeId: null,
      activeChannelId: null,
      channels: {},
      members: {},
      messages: {},
      hasMore: {},
      reactions: {},
      profiles: {},
      replyTo: null,
      unread: {},
      typing: {},
      reading: true,

      async init() {
        set({ loading: true, error: null });
        try {
          await get().refreshCommunities();
          const communities = get().communities;
          let last: string | null = null;
          try {
            last = localStorage.getItem(LAST_KEY);
          } catch {
            /* ignore */
          }
          const first = communities.find((c) => c.id === last) ?? communities[0] ?? null;
          set({ ready: true, loading: false });
          unsubscribeActivity?.();
          unsubscribeActivity = api().subscribeActivity((e) => {
            if (e.authorId === api().me) return;
            const s = get();
            if (s.activeChannelId === e.channelId && s.reading && isVisible()) {
              // You're looking at it: it's read as it arrives (the 'message' event adds it to the list).
              void api()
                .markRead({ id: e.channelId, communityId: e.communityId }, e.createdAt)
                .catch(() => {});
              marked.set(e.channelId, e.createdAt);
              return;
            }
            set((st) => ({
              unread: { ...st.unread, [e.channelId]: { communityId: e.communityId, count: Math.min(100, (st.unread[e.channelId]?.count ?? 0) + 1) } },
            }));
          });
          void get().refreshUnread();
          if (first) await get().select(first.id);
        } catch (err) {
          fail(err);
        }
      },

      async refreshCommunities() {
        const communities = await api().listCommunities();
        set((s) => ({ communities, activeId: s.activeId && communities.some((c) => c.id === s.activeId) ? s.activeId : null }));
      },

      async select(communityId) {
        unsubscribe?.();
        unsubscribe = null;
        typingChannel?.stop();
        typingChannel = null;
        set({ activeId: communityId, activeChannelId: null, replyTo: null });
        if (!communityId) return;
        try {
          localStorage.setItem(LAST_KEY, communityId);
        } catch {
          /* ignore */
        }
        try {
          const [channels, members] = await Promise.all([api().listChannels(communityId), api().listMembers(communityId)]);
          if (get().activeId !== communityId) return; // switched away while loading
          set((s) => ({ channels: { ...s.channels, [communityId]: channels }, members: { ...s.members, [communityId]: members } }));
          void ensureProfiles(members.map((m) => m.userId));
          unsubscribe = api().subscribe(communityId, applyEvent);
          typingChannel = api().subscribeTyping(communityId, (t) => get().noteTyping(t.channelId, t.userId));
          const first = channels.find((c) => c.name === 'general') ?? channels[0];
          if (first) await get().selectChannel(first.id);
        } catch (err) {
          fail(err);
        }
      },

      async selectChannel(channelId) {
        lastAnnounce = 0;
        set({ activeChannelId: channelId, replyTo: null });
        try {
          const page = await api().listMessages(channelId, { limit: PAGE });
          if (get().activeChannelId !== channelId) return;
          const asc = [...page].sort(byTime);
          set((s) => ({ messages: { ...s.messages, [channelId]: asc }, hasMore: { ...s.hasMore, [channelId]: page.length === PAGE } }));
          await Promise.all([ensureProfiles(asc.map((m) => m.authorId)), loadReactions(asc.map((m) => m.id))]);
          get().markActiveRead();
        } catch (err) {
          fail(err);
        }
      },

      async loadOlder() {
        const channelId = get().activeChannelId;
        if (!channelId || !get().hasMore[channelId]) return;
        const oldest = get().messages[channelId]?.[0];
        if (!oldest) return;
        const page = await api().listMessages(channelId, { before: { createdAt: oldest.createdAt, id: oldest.id }, limit: PAGE });
        set((s) => {
          const cur = s.messages[channelId] ?? [];
          const have = new Set(cur.map((m) => m.id));
          return {
            messages: { ...s.messages, [channelId]: [...page.filter((m) => !have.has(m.id)), ...cur].sort(byTime) },
            hasMore: { ...s.hasMore, [channelId]: page.length === PAGE },
          };
        });
        await Promise.all([ensureProfiles(page.map((m) => m.authorId)), loadReactions(page.map((m) => m.id))]);
      },

      async send(body, attachments) {
        const { activeId, activeChannelId, replyTo } = get();
        if (!activeId || !activeChannelId) return;
        const m = await api().sendMessage({ communityId: activeId, channelId: activeChannelId, body, attachments, replyTo: replyTo?.id ?? null });
        patchMessage(m);
        lastAnnounce = 0; // the next keystroke after sending should announce straight away
        set({ replyTo: null });
        await ensureProfiles([m.authorId]);
      },

      setReplyTo: (m) => set({ replyTo: m }),
      edit: async (id, body) => patchMessage(await api().editMessage(id, body)),
      remove: async (id) => patchMessage(await api().deleteMessage(id)),
      hide: async (id, reason) => patchMessage(await api().hideMessage(id, reason)),
      restore: async (id) => patchMessage(await api().restoreMessage(id)),
      stripLinks: async (id) => patchMessage(await api().stripLinks(id)),

      async toggleReaction(m, emoji) {
        const me = api().me;
        const mine = (get().reactions[m.id] ?? []).some((r) => r.userId === me && r.emoji === emoji);
        const reaction = { messageId: m.id, userId: me, emoji };
        // optimistic, then let the server confirm
        applyEvent({ type: mine ? 'reaction-removed' : 'reaction-added', reaction });
        try {
          if (mine) await api().removeReaction(m.id, emoji);
          else await api().addReaction({ id: m.id, communityId: m.communityId }, emoji);
        } catch (err) {
          applyEvent({ type: mine ? 'reaction-added' : 'reaction-removed', reaction });
          throw err;
        }
      },

      async refreshMembers() {
        const id = get().activeId;
        if (!id) return;
        try {
          const members = await api().listMembers(id);
          set((s) => ({ members: { ...s.members, [id]: members } }));
          void ensureProfiles(members.map((m) => m.userId));
          await get().refreshCommunities(); // my own role may have changed
        } catch {
          await get().refreshCommunities(); // we may have been removed
          if (!get().communities.some((c) => c.id === id)) void get().select(null);
        }
      },

      async refreshChannels() {
        const id = get().activeId;
        if (!id) return;
        const channels = await api().listChannels(id);
        set((s) => ({ channels: { ...s.channels, [id]: channels } }));
        const cur = get().activeChannelId;
        if (!cur || !channels.some((c) => c.id === cur)) {
          const first = channels[0];
          if (first) await get().selectChannel(first.id);
          else set({ activeChannelId: null });
        }
      },

      async refreshUnread() {
        try {
          const rows = await api().unreadCounts();
          set({ unread: Object.fromEntries(rows.map((r) => [r.channelId, { communityId: r.communityId, count: r.count }])) });
        } catch {
          /* badges are a nicety — never surface an error for them */
        }
      },

      markActiveRead() {
        const { activeChannelId, activeId, reading, messages } = get();
        if (!activeChannelId || !activeId || !reading || !isVisible()) return;
        const newest = messages[activeChannelId]?.at(-1)?.createdAt;
        if (get().unread[activeChannelId]) {
          set((s) => {
            const { [activeChannelId]: _read, ...rest } = s.unread;
            return { unread: rest };
          });
        }
        if (!newest || (marked.get(activeChannelId) ?? '') >= newest) return;
        marked.set(activeChannelId, newest);
        void api()
          .markRead({ id: activeChannelId, communityId: activeId }, newest)
          .catch(() => marked.delete(activeChannelId));
      },

      setReading(open) {
        set({ reading: open });
        if (open) get().markActiveRead();
      },

      announceTyping() {
        const channelId = get().activeChannelId;
        const now = Date.now();
        if (!channelId || !typingChannel || now - lastAnnounce < TYPING_ANNOUNCE_MS) return;
        lastAnnounce = now;
        typingChannel.announce(channelId);
      },

      noteTyping(channelId, userId) {
        const { activeId, members } = get();
        if (userId === api().me) return;
        // Only people who are really in this community can show up as typing (the signal itself is unauthenticated text).
        if (activeId && members[activeId] && !members[activeId].some((m) => m.userId === userId)) return;
        const now = Date.now();
        set((s) => {
          const live = Object.fromEntries(Object.entries(s.typing[channelId] ?? {}).filter(([, until]) => until > now));
          return { typing: { ...s.typing, [channelId]: { ...live, [userId]: now + TYPING_TTL_MS } } };
        });
      },

      dispose() {
        unsubscribe?.();
        unsubscribe = null;
        unsubscribeActivity?.();
        unsubscribeActivity = null;
        typingChannel?.stop();
        typingChannel = null;
      },
    };
  });
}
