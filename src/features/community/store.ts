import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { CommunityApi, TypingChannel } from './api';
import { channelKey, communityKey, communityLink, describeMessage, mentionKey, mentionsUser, type NotificationSink, noopSink } from './notifications';
import { isMuted, type PrefsStore, useCommunityPrefs } from './prefs';
import {
  type ActivityEvent,
  type Attachment,
  type Channel,
  type Community,
  CommunityError,
  type CommunityEvent,
  type CommunityMessage,
  type Member,
  type Profile,
  type Reaction,
} from './types';
import { TYPING_ANNOUNCE_MS, TYPING_TTL_MS, type TypingMap } from './typing';

const PAGE = 50;
const LAST_KEY = 'pact-community-last';
/** At most one toast per channel in this window, however fast the replies and mentions come. */
const TOAST_GAP_MS = 8000;
/** Coming back to the window re-syncs unread counts, but not more often than this. */
const RESYNC_GAP_MS = 5000;

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
  /** channelId → when (this computer's clock, ms) my slowmode wait ends. Only ever measures elapsed time, so a wrong system clock can't skew it. */
  cooldownUntil: Record<string, number>;
  /** True while the app-wide activity subscription (unread counts, notifications) is running. */
  activityOn: boolean;

  init(): Promise<void>;
  /** Keep unread counts and notifications live app-wide (idempotent: never a second subscription). */
  startActivity(): Promise<void>;
  stopActivity(): void;
  /** Sign-out or account switch: stop everything and forget everything. */
  reset(): void;
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
  /** Moderators and the admin. */
  setSlowmode(channelId: string, seconds: number): Promise<void>;
  refreshMembers(): Promise<void>;
  refreshChannels(): Promise<void>;
  refreshUnread(): Promise<void>;
  /** Mark the open channel read up to its newest message (if you are reading the newest and the window is visible). */
  markActiveRead(): void;
  setReading(open: boolean): void;
  /** The person muted/unmuted a community: its existing notification entries are marked read. */
  noteMuteChanged(communityId: string, muted: boolean): void;
  /** Tell the others I'm typing in the open channel (rate-limited). */
  announceTyping(): void;
  noteTyping(channelId: string, userId: string): void;
  /** The Communities view closed: stop the per-community live channels. (The app-wide activity feed keeps running.) */
  dispose(): void;
};

/** My own membership row in a community (carries my timeout). */
export const myMembership = (s: Pick<CommunityState, 'members'>, communityId: string, me: string): Member | undefined =>
  s.members[communityId]?.find((m) => m.userId === me);

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
export function createCommunityStore(
  getApi: () => CommunityApi,
  deps: { prefs?: PrefsStore; sink?: NotificationSink } = {},
): UseBoundStore<StoreApi<CommunityState>> {
  const prefs = deps.prefs ?? useCommunityPrefs;
  const sink = deps.sink ?? noopSink;
  let unsubscribe: (() => void) | null = null;
  let unsubscribeActivity: (() => void) | null = null;
  let stopResync: (() => void) | null = null;
  let typingChannel: TypingChannel | null = null;
  let lastAnnounce = 0;
  /** channelId → the newest createdAt we've already told the server about, so we don't repeat ourselves. */
  const marked = new Map<string, string>();
  /** channelId → when we last toasted, and replied-to authors we've already looked up. */
  const toasted = new Map<string, number>();
  const authors = new Map<string, string | null>();
  /** Bumped by `reset()`: an answer that arrives after an account switch must not land in the new account's state. */
  let epoch = 0;

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

    /** Is the person looking at this channel's newest messages right now? (Then a new message is read as it arrives.) */
    const looking = (channelId: string) => {
      const s = get();
      return s.activeChannelId === channelId && s.reading && isVisible();
    };

    /** Names for a notification. Fetched only when needed, and kept (the Communities view reuses them). */
    async function namesFor(e: ActivityEvent) {
      if (!get().communities.some((c) => c.id === e.communityId)) await get().refreshCommunities();
      if (!get().channels[e.communityId]?.some((c) => c.id === e.channelId)) {
        // never loaded, or a channel created since: ask once
        const channels = await api().listChannels(e.communityId);
        set((s) => ({ channels: { ...s.channels, [e.communityId]: channels } }));
      }
      await ensureProfiles([e.authorId, api().me]);
      const s = get();
      return {
        community: s.communities.find((c) => c.id === e.communityId)?.name ?? 'A community',
        channel: s.channels[e.communityId]?.find((c) => c.id === e.channelId)?.name ?? 'channel',
        author: s.profiles[e.authorId]?.displayName || s.profiles[e.authorId]?.username || 'Someone',
        myUsername: s.profiles[api().me]?.username,
      };
    }

    /** Is this message a reply to something I wrote? (Looks in what's loaded first, then asks the server once.) */
    async function isReplyToMe(e: ActivityEvent) {
      if (!e.replyTo) return false;
      const local = get().messages[e.channelId]?.find((m) => m.id === e.replyTo)?.authorId;
      let author = local ?? authors.get(e.replyTo);
      if (author === undefined) {
        author = await api()
          .getMessageAuthor(e.replyTo)
          .catch(() => null);
        authors.set(e.replyTo, author);
      }
      return author === api().me;
    }

    /** A message arrived in a channel the person isn't looking at: tell them, quietly (one entry per channel), or loudly if it's for them. */
    async function announce(e: ActivityEvent) {
      const era = epoch;
      try {
        const [names, reply] = await Promise.all([namesFor(e), isReplyToMe(e)]);
        // things may have changed while we looked names up
        if (era !== epoch || looking(e.channelId) || isMuted(prefs.getState().muted, e.communityId)) return;
        const mention = mentionsUser(e.body, names.myUsername);
        const line = describeMessage(names.author, e.body, e.hasAttachments);
        const sub = communityLink(e.communityId, e.channelId);
        const count = get().unread[e.channelId]?.count ?? 1;
        sink.upsert({
          key: channelKey(e.communityId, e.channelId),
          title: `${names.community} · #${names.channel}`,
          body: count > 1 ? `${count} new messages — ${line}` : line,
          sub,
        });
        if (!reply && !mention) return;
        const title = `${names.author} ${reply ? 'replied to you' : 'mentioned you'}`;
        const body = `#${names.channel} · ${names.community}: ${e.body.trim().replace(/\s+/g, ' ').slice(0, 120) || (e.hasAttachments ? 'an attachment' : '')}`;
        sink.upsert({ key: mentionKey(e.communityId, e.channelId, e.messageId), title, body, sub });
        const last = toasted.get(e.channelId) ?? 0;
        if (isVisible() && Date.now() - last >= TOAST_GAP_MS) {
          toasted.set(e.channelId, Date.now());
          sink.toast({ title, body, sub });
        }
      } catch {
        /* notifications are a nicety — a failed name lookup must never surface an error */
      }
    }

    function onActivity(e: ActivityEvent) {
      if (e.authorId === api().me) return;
      if (looking(e.channelId)) {
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
      // Muted communities still count (so unmuting shows the truth) but never badge, notify or toast.
      if (!isMuted(prefs.getState().muted, e.communityId)) void announce(e);
    }

    const initial: Pick<
      CommunityState,
      | 'ready'
      | 'loading'
      | 'error'
      | 'communities'
      | 'activeId'
      | 'activeChannelId'
      | 'channels'
      | 'members'
      | 'messages'
      | 'hasMore'
      | 'reactions'
      | 'profiles'
      | 'replyTo'
      | 'unread'
      | 'typing'
      | 'reading'
      | 'cooldownUntil'
      | 'activityOn'
    > = {
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
      cooldownUntil: {},
      activityOn: false,
    };

    return {
      ...initial,

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
          // (not awaited: unread counts and names fill in while the first channel loads)
          void get()
            .startActivity()
            .catch(() => {});
          if (first) await get().select(first.id);
        } catch (err) {
          fail(err);
        }
      },

      async startActivity() {
        if (get().activityOn) {
          void get().refreshUnread();
          return;
        }
        set({ activityOn: true });
        unsubscribeActivity = api().subscribeActivity(onActivity);
        // Realtime only pushes what arrives while we're connected: re-sync when the window comes back or the network does.
        let lastSync = Date.now();
        const resync = () => {
          if (!isVisible() || Date.now() - lastSync < RESYNC_GAP_MS) return;
          lastSync = Date.now();
          void get().refreshUnread();
        };
        document.addEventListener('visibilitychange', resync);
        window.addEventListener('online', resync);
        stopResync = () => {
          document.removeEventListener('visibilitychange', resync);
          window.removeEventListener('online', resync);
        };
        await Promise.all([
          get().refreshUnread(),
          get().communities.length
            ? Promise.resolve()
            : get()
                .refreshCommunities()
                .catch(() => {}),
          ensureProfiles([api().me]).catch(() => {}),
        ]);
      },

      stopActivity() {
        unsubscribeActivity?.();
        unsubscribeActivity = null;
        stopResync?.();
        stopResync = null;
        if (get().activityOn) set({ activityOn: false });
      },

      reset() {
        epoch++;
        get().stopActivity();
        unsubscribe?.();
        unsubscribe = null;
        typingChannel?.stop();
        typingChannel = null;
        marked.clear();
        toasted.clear();
        authors.clear();
        lastAnnounce = 0;
        set({ ...initial });
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
        let m: CommunityMessage;
        try {
          m = await api().sendMessage({ communityId: activeId, channelId: activeChannelId, body, attachments, replyTo: replyTo?.id ?? null });
        } catch (err) {
          if (err instanceof CommunityError) {
            // The server's answer is the truth about the clock: wait exactly as long as it says (and never trust our own sums).
            if (err.code === 'slowmode' && err.detail?.seconds)
              set((s) => ({ cooldownUntil: { ...s.cooldownUntil, [activeChannelId]: Date.now() + (err.detail?.seconds ?? 0) * 1000 } }));
            // We thought we could post, but a moderator has timed us out: pick that up now.
            if (err.code === 'timed_out') void get().refreshMembers();
          }
          throw err;
        }
        patchMessage(m);
        const gap = get().channels[activeId]?.find((c) => c.id === activeChannelId)?.slowmodeSeconds ?? 0;
        if (gap > 0) set((s) => ({ cooldownUntil: { ...s.cooldownUntil, [activeChannelId]: Date.now() + gap * 1000 } }));
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
          if (err instanceof CommunityError && err.code === 'timed_out') void get().refreshMembers();
          throw err;
        }
      },

      async setSlowmode(channelId, seconds) {
        const ch = await api().setSlowmode(channelId, seconds);
        set((s) => ({ channels: { ...s.channels, [ch.communityId]: (s.channels[ch.communityId] ?? []).map((c) => (c.id === ch.id ? ch : c)) } }));
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
        const era = epoch;
        try {
          const rows = await api().unreadCounts();
          if (era !== epoch) return;
          const before = get().unread;
          const next = Object.fromEntries(rows.map((r) => [r.channelId, { communityId: r.communityId, count: r.count }]));
          set({ unread: next });
          // read on another device (or here): the notification entries for those channels are done
          for (const [channelId, u] of Object.entries(before)) if (!next[channelId]) sink.resolve(channelKey(u.communityId, channelId));
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
        sink.resolve(channelKey(activeId, activeChannelId));
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

      noteMuteChanged(communityId, muted) {
        if (muted) sink.resolve(communityKey(communityId));
      },

      dispose() {
        unsubscribe?.();
        unsubscribe = null;
        typingChannel?.stop();
        typingChannel = null;
      },
    };
  });
}
