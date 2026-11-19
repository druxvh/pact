/**
 * The Activity state: my note, the feed, hearts and comments, and the small real inbox (likes, comments and private replies).
 * Built over `ActivityApi`, like the Now playing store, and — like it — it routes by who a thing is about:
 *
 *   • a real account id → the signed-in user's API (Supabase, via `getApi`);
 *   • a simulated person's id (`alex`… — not an account id) → the in-memory demo API (`demo.ts`), never the network.
 *
 * What it promises:
 *   • hearts are optimistic: the count and the "liked by you" state change at once, a burst of clicks is folded into one request
 *     per direction, and a failure puts back exactly what the server last confirmed (and tells the caller);
 *   • every list is de-duplicated by id, and a late answer that belongs to an account that has since signed out is thrown away
 *     (`epoch`), so one person's activity can never land in another person's state;
 *   • a note counts only while it is unexpired, by OUR clock too: a sweep drops it at its end time, since a "delete" can't be
 *     pushed to someone who is offline;
 *   • bubbles on avatars come from the feed's first page(s) — notes of people I may see — so only someone on screen costs anything,
 *     and the feed is loaded once, not once per avatar;
 *   • nothing here renders anything: every string is text from other people and is cleaned again where it is shown.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { isUserId } from '@/features/nowplaying/api';
import type { Track } from '@/features/nowplaying/track';
import type { ActivityApi, ActivityEvent } from './api';
import { counterpart, isUnreadForMe, noticeFor, refOfNote, threadLink, unreadTotal } from './describe';
import {
  ActivityError,
  type ActivityMessage,
  type Comment,
  type Engagement,
  type FeedItem,
  type MessageContext,
  NO_ENGAGEMENT,
  type Note,
  refKey,
  type SubjectRef,
  type Visibility,
} from './types';

export const FEED_PAGE = 40;
export const COMMENTS_PAGE = 20;
export const MESSAGES_PAGE = 100;
const MESSAGES_KEPT = 400;
const SWEEP_MS = 30_000;
const REFRESH_DEBOUNCE_MS = 400;
const RETRY_MS = 30_000;
const UNAVAILABLE_MS = 10 * 60_000;
const ENGAGEMENT_STALE_MS = 30_000;
const ENGAGEMENT_BATCH_MS = 60;
const ENGAGEMENT_CHUNK = 50;
const RECENT_MAX = 5;
const TOAST_GAP_MS = 8000;

export type Status = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
export type CommentList = { items: Comment[]; status: Status; more: boolean; loadingMore: boolean };
const NO_COMMENTS: CommentList = { items: [], status: 'idle', more: false, loadingMore: false };

/** How the store reaches the notification centre and toasts (so it stays testable without them). */
export type ActivitySink = {
  /** One bell entry per `key` (a message). */
  notice(n: { key: string; title: string; body: string; sub: string }): void;
  /** Everything whose key starts with `keyPrefix` has been seen. */
  resolve(keyPrefix: string): void;
  toast?(t: { title: string; body: string; sub: string }): void;
};

export type ActivityDeps = {
  now?: () => number;
  /** The API for simulated people (their ids aren't accounts). */
  demo?: () => ActivityApi;
  /** A display name for a notice. May be slow; failures fall back to "Someone". */
  names?: (id: string) => Promise<string>;
  /** The ids of the people in my communities (who the feed is about). */
  peers?: () => Promise<string[]>;
  sink?: ActivitySink;
  visible?: () => boolean;
};

export type MineState = { note: Note | null; loaded: boolean; visibility: Visibility | null; unavailable: boolean };

export type ActivityState = {
  mine: MineState;
  /** Current, unexpired notes by owner — what the bubbles on avatars show. Mine, the feed's, and the simulated people's. */
  notes: Record<string, Note>;
  feed: FeedItem[];
  feedStatus: Status;
  /** More (older) notes can be asked for. */
  hasMore: boolean;
  loadingMore: boolean;
  engagement: Record<string, Engagement>;
  comments: Record<string, CommentList>;
  /** Messages in both directions, newest first (at most the latest few hundred). */
  messages: ActivityMessage[];
  messagesStatus: Status;
  /** Whose thread is open and on screen right now: their new messages are read as they arrive. */
  viewing: string | null;
  peers: string[];
  /** Songs this browser played lately (this session only — nothing is kept), to pick one for a note. */
  recent: Track[];

  loadMine(): Promise<void>;
  postNote(input: { text: string; track: Track | null; visibility?: Visibility }): Promise<Note>;
  deleteNote(): Promise<void>;
  setVisibility(v: Visibility): Promise<void>;

  /** Load the feed's first page if it hasn't been (idempotent; retries after a failure only every 30 s). */
  ensureFeed(): Promise<void>;
  refreshFeed(): Promise<void>;
  loadMoreFeed(): Promise<void>;
  loadPeers(): Promise<void>;
  /** An avatar or card for this person is on screen: make sure their note is known. Returns a no-op. */
  watchNote(ownerId: string): () => void;
  /** Someone cares about these counts: fetch them (batched) unless they are fresh. Returns the function that stops caring. */
  watchEngagement(ref: SubjectRef): () => void;
  /** Heart or un-heart. Optimistic; rejects (after putting the previous state back) when the server says no. */
  toggleLike(ref: SubjectRef, context: MessageContext): Promise<void>;

  loadComments(ref: SubjectRef): Promise<void>;
  loadMoreComments(ref: SubjectRef): Promise<void>;
  addComment(ref: SubjectRef, body: string, context: MessageContext): Promise<void>;
  deleteComment(ref: SubjectRef, id: string): Promise<void>;

  loadMessages(): Promise<void>;
  /** Fetch one thread's messages (the latest page, or older ones `before` a time). Returns how many were new. */
  loadThread(personId: string, before?: string): Promise<number>;
  sendReply(to: string, body: string, context: MessageContext | null): Promise<ActivityMessage>;
  markThreadRead(personId: string): Promise<void>;
  setViewing(personId: string | null): void;

  noteRecent(track: Track | null): void;
  /** Signed in: follow live changes, sweep expired notes, load my note and my messages. Idempotent. */
  start(): Promise<void>;
  /** Sign-in, sign-out or account switch: stop following and forget every person's activity. */
  reset(): void;
};

export type ActivityStore = UseBoundStore<StoreApi<ActivityState>>;

const emptyMine: MineState = { note: null, loaded: false, visibility: null, unavailable: false };

/** `rank(a) > rank(b)` iff `a` is newer. */
const newestFirst = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

/** Merge a freshly fetched FIRST page into what we have: the page wins; older items we already loaded stay (when the page was full). */
export function mergeFeedHead(existing: readonly FeedItem[], page: readonly FeedItem[], full: boolean): FeedItem[] {
  const cut = page.at(-1)?.at;
  const kept = full && cut ? existing.filter((i) => i.at < cut) : [];
  return dedupeFeed([...page, ...kept]);
}

/** One note per person (the newest) and one entry per subject, newest first. */
export function dedupeFeed(items: readonly FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  const owners = new Set<string>();
  const out: FeedItem[] = [];
  for (const i of [...items].sort((a, b) => b.at.localeCompare(a.at))) {
    const k = refKey(i.ref);
    if (seen.has(k) || (i.kind === 'note' && owners.has(i.ref.ownerId))) continue;
    seen.add(k);
    if (i.kind === 'note') owners.add(i.ref.ownerId);
    out.push(i);
  }
  return out;
}

const expired = (n: Note, now: number) => Date.parse(n.expiresAt) <= now;

export function createActivityStore(getApi: () => ActivityApi | null, deps: ActivityDeps = {}): ActivityStore {
  const now = deps.now ?? Date.now;
  const visible = deps.visible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible');
  const sink = deps.sink;

  return create<ActivityState>((set, get) => {
    let epoch = 0;
    let unsubscribe: (() => void) | null = null;
    let sweepTimer: ReturnType<typeof setInterval> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let removeListeners: (() => void) | null = null;
    let feedPromise: Promise<void> | null = null;
    /** A change arrived while the feed was loading: ask once more when it is done. */
    let feedAgain = false;
    let lastFeedTry = 0;
    let unavailableUntil = 0;
    let demoLoaded = false;
    let lastToast = 0;
    const engagementAt = new Map<string, number>();
    const wanted = new Map<string, { ref: SubjectRef; n: number }>();
    let engagementTimer: ReturnType<typeof setTimeout> | undefined;
    const likes = new Map<string, { base: Engagement; wanted: boolean; running: boolean }>();

    const me = (): string | null => getApi()?.me ?? null;
    const requireApi = (): ActivityApi => {
      const api = getApi();
      if (!api) throw new ActivityError('not_signed_in');
      return api;
    };
    /** Real accounts go to the real API; simulated people to the demo one. */
    const apiFor = (ownerId: string): ActivityApi => {
      if (isUserId(ownerId)) return requireApi();
      const demo = deps.demo?.();
      if (!demo) throw new ActivityError('unavailable');
      return demo;
    };
    const setEngagement = (k: string, e: Engagement) => set((s) => ({ engagement: { ...s.engagement, [k]: e } }));

    // ── notes ──

    /** Notes by owner from what we hold: the feed's, mine, and the simulated people's (kept from before). */
    const deriveNotes = (s: Pick<ActivityState, 'notes' | 'feed' | 'mine'>, myId: string | null): Record<string, Note> => {
      const next: Record<string, Note> = {};
      for (const [id, n] of Object.entries(s.notes)) if (!isUserId(id)) next[id] = n;
      for (const i of s.feed) if (i.kind === 'note') next[i.ref.ownerId] = i.note;
      if (s.mine.note && myId) next[myId] = s.mine.note;
      return next;
    };

    const seedEngagement = (items: readonly FeedItem[]) => {
      const t = now();
      set((s) => {
        const next = { ...s.engagement };
        for (const i of items) {
          const k = refKey(i.ref);
          if (likes.has(k)) continue; // an optimistic change is in flight: don't overwrite it
          next[k] = i.engagement;
          engagementAt.set(k, t);
        }
        return { engagement: next };
      });
    };

    const applyFeed = (feed: FeedItem[], extra: Partial<ActivityState> = {}) => {
      set((s) => ({ feed, notes: deriveNotes({ ...s, feed }, me()), ...extra }));
      seedEngagement(feed);
    };

    async function loadDemoNotes() {
      if (demoLoaded || !deps.demo) return;
      demoLoaded = true;
      try {
        const items = await deps.demo().feed({ limit: 100 });
        set((s) => ({
          notes: {
            ...s.notes,
            ...Object.fromEntries(items.filter((i) => i.kind === 'note').map((i) => [i.ref.ownerId, (i as Extract<FeedItem, { kind: 'note' }>).note])),
          },
        }));
        seedEngagement(items);
      } catch {
        demoLoaded = false;
      }
    }

    // ── engagement ──

    async function fetchEngagement(refs: SubjectRef[]) {
      const era = epoch;
      const groups = new Map<ActivityApi, SubjectRef[]>();
      for (const r of refs) {
        let api: ActivityApi;
        try {
          api = apiFor(r.ownerId);
        } catch {
          continue;
        }
        groups.set(api, [...(groups.get(api) ?? []), r]);
      }
      await Promise.all(
        [...groups].map(async ([api, list]) => {
          for (let i = 0; i < list.length; i += ENGAGEMENT_CHUNK) {
            const chunk = list.slice(i, i + ENGAGEMENT_CHUNK);
            try {
              const got = await api.engagement(chunk);
              if (era !== epoch) return;
              const t = now();
              set((s) => {
                const next = { ...s.engagement };
                for (const r of chunk) {
                  const k = refKey(r);
                  if (likes.has(k)) continue; // optimistic change in flight
                  next[k] = got[k] ?? NO_ENGAGEMENT;
                  engagementAt.set(k, t);
                }
                return { engagement: next };
              });
            } catch {
              /* counts are a nicety — keep what we show */
            }
          }
        }),
      );
    }

    const scheduleEngagement = () => {
      if (engagementTimer) return;
      engagementTimer = setTimeout(() => {
        engagementTimer = undefined;
        const t = now();
        const due = [...wanted.values()].map((w) => w.ref).filter((r) => t - (engagementAt.get(refKey(r)) ?? 0) >= ENGAGEMENT_STALE_MS);
        if (due.length > 0) void fetchEngagement(due);
      }, ENGAGEMENT_BATCH_MS);
    };

    // ── messages ──

    const putMessages = (incoming: readonly ActivityMessage[]) => {
      set((s) => {
        const byId = new Map(s.messages.map((m) => [m.id, m]));
        for (const m of incoming) byId.set(m.id, byId.has(m.id) ? { ...(byId.get(m.id) as ActivityMessage), ...m } : m);
        return { messages: [...byId.values()].sort(newestFirst).slice(0, MESSAGES_KEPT) };
      });
    };

    async function announce(m: ActivityMessage) {
      const era = epoch;
      const mine = me();
      if (!mine || !isUnreadForMe(m, mine)) return;
      if (get().viewing === m.senderId && visible()) {
        void get().markThreadRead(m.senderId);
        return;
      }
      let name = 'Someone';
      try {
        name = (await deps.names?.(m.senderId)) || name;
      } catch {
        /* a name is a nicety */
      }
      if (era !== epoch || get().messages.find((x) => x.id === m.id)?.readAt) return; // read (or signed out) while we looked the name up
      const text = noticeFor(m, name);
      const sub = threadLink(m.senderId);
      sink?.notice({ key: `activity:${m.senderId}:${m.id}`, ...text, sub });
      if (m.kind !== 'like' && visible() && now() - lastToast >= TOAST_GAP_MS) {
        lastToast = now();
        sink?.toast?.({ ...text, sub });
      }
    }

    const ingest = (m: ActivityMessage) => {
      const known = get().messages.some((x) => x.id === m.id);
      putMessages([m]);
      if (!known) void announce(m);
    };

    // ── live ──

    const onEvent = (e: ActivityEvent) => {
      if (e.type === 'message') {
        ingest(e.message);
      } else if (e.type === 'note') {
        if (e.ownerId === me()) void get().loadMine();
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => void get().refreshFeed(), REFRESH_DEBOUNCE_MS);
      } else if (e.type === 'engagement' && e.ref) {
        const k = refKey(e.ref);
        if (wanted.has(k) || get().engagement[k]) {
          engagementAt.delete(k);
          void fetchEngagement([e.ref]);
        }
        if (get().comments[k]) void get().loadComments(e.ref);
      }
    };

    const sweep = () => {
      const t = now();
      const s = get();
      const feed = s.feed.filter((i) => i.kind !== 'note' || !expired(i.note, t));
      const gone = Object.entries(s.notes).filter(([id, n]) => isUserId(id) && expired(n, t));
      const mineExpired = s.mine.note && expired(s.mine.note, t);
      if (feed.length === s.feed.length && gone.length === 0 && !mineExpired) return;
      set((cur) => {
        const mine = mineExpired ? { ...cur.mine, note: null } : cur.mine;
        const notes = Object.fromEntries(Object.entries(cur.notes).filter(([id, n]) => !isUserId(id) || !expired(n, t)));
        return { feed, mine, notes };
      });
    };

    const stop = () => {
      unsubscribe?.();
      unsubscribe = null;
      clearInterval(sweepTimer);
      sweepTimer = undefined;
      clearTimeout(refreshTimer);
      removeListeners?.();
      removeListeners = null;
    };

    const initial = () => ({
      mine: emptyMine,
      notes: {} as Record<string, Note>,
      feed: [] as FeedItem[],
      feedStatus: 'idle' as Status,
      hasMore: false,
      loadingMore: false,
      engagement: {} as Record<string, Engagement>,
      comments: {} as Record<string, CommentList>,
      messages: [] as ActivityMessage[],
      messagesStatus: 'idle' as Status,
      viewing: null as string | null,
      peers: [] as string[],
      recent: [] as Track[],
    });

    const statusOf = (err: unknown): Status => (err instanceof ActivityError && err.code === 'unavailable' ? 'unavailable' : 'error');

    return {
      ...initial(),

      // ── my note ──

      async loadMine() {
        const api = getApi();
        if (!api) return;
        const era = epoch;
        const [note, visibility] = await Promise.allSettled([api.getMyNote(), api.getNotesVisibility()]);
        if (era !== epoch) return;
        const unavailable = [note, visibility].some((r) => r.status === 'rejected' && (r.reason as { code?: string })?.code === 'unavailable');
        set((s) => {
          const mine: MineState = {
            note: note.status === 'fulfilled' ? note.value : s.mine.note,
            visibility: visibility.status === 'fulfilled' ? visibility.value : s.mine.visibility,
            loaded: true,
            unavailable,
          };
          return { mine, notes: deriveNotes({ ...s, mine }, api.me) };
        });
        if (unavailable) unavailableUntil = now() + UNAVAILABLE_MS;
      },

      async postNote({ text, track, visibility }) {
        const api = requireApi();
        const era = epoch;
        if (visibility && visibility !== get().mine.visibility) {
          await api.setNotesVisibility(visibility);
          if (era === epoch) set((s) => ({ mine: { ...s.mine, visibility } }));
        }
        const note = await api.postNote({ text, track });
        if (era !== epoch) return note;
        const item: FeedItem = { kind: 'note', ref: refOfNote(note), at: note.createdAt, note, engagement: NO_ENGAGEMENT };
        set((s) => ({ mine: { ...s.mine, note, loaded: true } }));
        applyFeed(dedupeFeed([item, ...get().feed.filter((i) => i.ref.ownerId !== api.me || i.kind !== 'note')]));
        return note;
      },

      async deleteNote() {
        const api = requireApi();
        await api.deleteMyNote();
        set((s) => ({ mine: { ...s.mine, note: null } }));
        applyFeed(get().feed.filter((i) => !(i.kind === 'note' && i.ref.ownerId === api.me)));
      },

      async setVisibility(v) {
        const api = requireApi();
        await api.setNotesVisibility(v);
        set((s) => ({ mine: { ...s.mine, visibility: v, note: v === 'off' ? null : s.mine.note } }));
        if (v === 'off') applyFeed(get().feed.filter((i) => !(i.kind === 'note' && i.ref.ownerId === api.me)));
      },

      // ── the feed ──

      ensureFeed() {
        const t = now();
        if (!getApi() || t < unavailableUntil) return Promise.resolve();
        if (feedPromise) return feedPromise;
        const { feedStatus } = get();
        if (feedStatus === 'ready' || feedStatus === 'unavailable' || (feedStatus === 'error' && t - lastFeedTry < RETRY_MS)) return Promise.resolve();
        return get().refreshFeed();
      },

      refreshFeed() {
        const api = getApi();
        if (!api || now() < unavailableUntil) return Promise.resolve();
        if (feedPromise) {
          feedAgain = true;
          return feedPromise;
        }
        const era = epoch;
        lastFeedTry = now();
        if (get().feedStatus !== 'ready') set({ feedStatus: 'loading' });
        const run = (async () => {
          try {
            const page = await api.feed({ limit: FEED_PAGE });
            if (era !== epoch) return;
            const full = page.length >= FEED_PAGE;
            const merged = mergeFeedHead(get().feed, page, full);
            applyFeed(merged, { feedStatus: 'ready', hasMore: full || merged.length > page.length });
            void get().loadPeers();
          } catch (err) {
            if (era !== epoch) return;
            const status = statusOf(err);
            if (status === 'unavailable') unavailableUntil = now() + UNAVAILABLE_MS;
            set((s) => ({ feedStatus: s.feed.length > 0 && status === 'error' ? 'ready' : status }));
          } finally {
            feedPromise = null;
            if (feedAgain && era === epoch) {
              feedAgain = false;
              void get().refreshFeed();
            }
          }
        })();
        feedPromise = run;
        return run;
      },

      async loadMoreFeed() {
        const api = getApi();
        const { feed, hasMore, loadingMore } = get();
        const last = feed.at(-1);
        if (!api || !hasMore || loadingMore || !last) return;
        const era = epoch;
        set({ loadingMore: true });
        try {
          const page = await api.feed({ limit: FEED_PAGE, before: last.at });
          if (era !== epoch) return;
          applyFeed(dedupeFeed([...get().feed, ...page]), { hasMore: page.length >= FEED_PAGE, loadingMore: false });
        } catch (err) {
          if (era === epoch) set({ loadingMore: false });
          throw err;
        }
      },

      async loadPeers() {
        if (!deps.peers || get().peers.length > 0) return;
        const era = epoch;
        try {
          const peers = await deps.peers();
          if (era === epoch) set({ peers });
        } catch {
          /* the feed still works without "listening now" */
        }
      },

      watchNote(ownerId) {
        if (!isUserId(ownerId)) void loadDemoNotes();
        else if (getApi()) void get().ensureFeed();
        return () => {};
      },

      // ── hearts ──

      watchEngagement(ref) {
        const k = refKey(ref);
        wanted.set(k, { ref, n: (wanted.get(k)?.n ?? 0) + 1 });
        scheduleEngagement();
        let released = false;
        return () => {
          if (released) return;
          released = true;
          const w = wanted.get(k);
          if (!w || w.n <= 1) wanted.delete(k);
          else w.n -= 1;
        };
      },

      async toggleLike(ref, context) {
        const api = apiFor(ref.ownerId);
        const k = refKey(ref);
        const era = epoch;
        const current = get().engagement[k] ?? NO_ENGAGEMENT;
        const want = !current.likedByMe;
        setEngagement(k, { ...current, likedByMe: want, likes: Math.max(0, current.likes + (want ? 1 : -1)) });
        const running = likes.get(k);
        if (running) {
          running.wanted = want; // the request in flight picks up the latest wish when it finishes
          return;
        }
        const st = { base: current, wanted: want, running: true };
        likes.set(k, st);
        let serverLiked = current.likedByMe;
        try {
          while (serverLiked !== st.wanted) {
            const target = st.wanted;
            if (target) await api.like(ref, context);
            else await api.unlike(ref);
            serverLiked = target;
            st.base = { ...st.base, likedByMe: target, likes: Math.max(0, st.base.likes + (target ? 1 : -1)) };
          }
        } catch (err) {
          if (era === epoch) setEngagement(k, st.base); // what the server last confirmed
          throw err;
        } finally {
          likes.delete(k);
        }
      },

      // ── comments ──

      async loadComments(ref) {
        const k = refKey(ref);
        const era = epoch;
        const had = get().comments[k];
        set((s) => ({ comments: { ...s.comments, [k]: { ...(had ?? NO_COMMENTS), status: had?.status === 'ready' ? 'ready' : 'loading' } } }));
        try {
          const page = await apiFor(ref.ownerId).comments(ref, { limit: COMMENTS_PAGE });
          if (era !== epoch) return;
          set((s) => {
            const cur = s.comments[k] ?? NO_COMMENTS;
            // keep what we hold that is older than this page (loaded earlier) and anything still being sent
            const oldest = page.length >= COMMENTS_PAGE ? ([...page].map((c) => c.createdAt).sort()[0] ?? '') : '';
            const keep = cur.items.filter((c) => c.id.startsWith('pending:') || (oldest && c.createdAt < oldest && !page.some((p) => p.id === c.id)));
            const items = [...new Map([...keep, ...page].map((c) => [c.id, c])).values()].sort(
              (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
            );
            return {
              comments: {
                ...s.comments,
                [k]: {
                  items,
                  status: 'ready',
                  more: page.length >= COMMENTS_PAGE ? (keep.some((c) => !c.id.startsWith('pending:')) ? cur.more : true) : false,
                  loadingMore: false,
                },
              },
            };
          });
        } catch (err) {
          if (era === epoch)
            set((s) => ({ comments: { ...s.comments, [k]: { ...(s.comments[k] ?? NO_COMMENTS), status: statusOf(err), loadingMore: false } } }));
        }
      },

      async loadMoreComments(ref) {
        const k = refKey(ref);
        const cur = get().comments[k];
        const oldest = cur?.items.find((c) => !c.id.startsWith('pending:'));
        if (!cur?.more || cur.loadingMore || !oldest) return;
        const era = epoch;
        set((s) => ({ comments: { ...s.comments, [k]: { ...cur, loadingMore: true } } }));
        try {
          const page = await apiFor(ref.ownerId).comments(ref, { limit: COMMENTS_PAGE, before: oldest.createdAt });
          if (era !== epoch) return;
          set((s) => {
            const c = s.comments[k] ?? NO_COMMENTS;
            const items = [...new Map([...page, ...c.items].map((x) => [x.id, x])).values()].sort(
              (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
            );
            return { comments: { ...s.comments, [k]: { ...c, items, more: page.length >= COMMENTS_PAGE, loadingMore: false } } };
          });
        } catch (err) {
          if (era === epoch) set((s) => ({ comments: { ...s.comments, [k]: { ...(s.comments[k] ?? NO_COMMENTS), loadingMore: false } } }));
          throw err;
        }
      },

      async addComment(ref, body, context) {
        const api = apiFor(ref.ownerId);
        const k = refKey(ref);
        const era = epoch;
        const pending: Comment = {
          id: `pending:${now()}:${Math.random().toString(36).slice(2, 8)}`,
          ref,
          authorId: api.me,
          body,
          createdAt: new Date(now()).toISOString(),
        };
        const bump = (d: number) =>
          set((s) => {
            const e = s.engagement[k] ?? NO_ENGAGEMENT;
            return { engagement: { ...s.engagement, [k]: { ...e, comments: Math.max(0, e.comments + d) } } };
          });
        set((s) => {
          const cur = s.comments[k] ?? { ...NO_COMMENTS, status: 'ready' as Status };
          return { comments: { ...s.comments, [k]: { ...cur, items: [...cur.items, pending] } } };
        });
        bump(1);
        try {
          const saved = await api.addComment(ref, body, context);
          if (era !== epoch) return;
          set((s) => {
            const cur = s.comments[k] ?? NO_COMMENTS;
            const items = [...cur.items.filter((c) => c.id !== pending.id && c.id !== saved.id), saved].sort(
              (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
            );
            return { comments: { ...s.comments, [k]: { ...cur, items } } };
          });
        } catch (err) {
          if (era === epoch) {
            set((s) => {
              const cur = s.comments[k];
              return cur ? { comments: { ...s.comments, [k]: { ...cur, items: cur.items.filter((c) => c.id !== pending.id) } } } : s;
            });
            bump(-1);
          }
          throw err;
        }
      },

      async deleteComment(ref, id) {
        const k = refKey(ref);
        const era = epoch;
        const before = get().comments[k];
        const removed = before?.items.find((c) => c.id === id);
        if (!before || !removed) return;
        set((s) => ({ comments: { ...s.comments, [k]: { ...before, items: before.items.filter((c) => c.id !== id) } } }));
        setEngagement(k, { ...(get().engagement[k] ?? NO_ENGAGEMENT), comments: Math.max(0, (get().engagement[k] ?? NO_ENGAGEMENT).comments - 1) });
        try {
          if (!id.startsWith('pending:')) await apiFor(ref.ownerId).deleteComment(id);
        } catch (err) {
          if (era === epoch) {
            set((s) => {
              const cur = s.comments[k] ?? before;
              const items = [...cur.items, removed].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
              return { comments: { ...s.comments, [k]: { ...cur, items } } };
            });
            setEngagement(k, { ...(get().engagement[k] ?? NO_ENGAGEMENT), comments: (get().engagement[k] ?? NO_ENGAGEMENT).comments + 1 });
          }
          throw err;
        }
      },

      // ── messages ──

      async loadMessages() {
        const api = getApi();
        if (!api) return;
        const era = epoch;
        if (get().messagesStatus !== 'ready') set({ messagesStatus: 'loading' });
        try {
          const page = await api.messages({ limit: MESSAGES_PAGE });
          if (era !== epoch) return;
          putMessages(page);
          set({ messagesStatus: 'ready' });
        } catch (err) {
          if (era === epoch) set({ messagesStatus: statusOf(err) });
        }
      },

      async loadThread(personId, before) {
        const api = getApi();
        // a simulated person has no activity messages: never ask the database about an id that isn't an account
        if (!api || !isUserId(personId)) return 0;
        const era = epoch;
        const page = await api.messages({ with: personId, limit: MESSAGES_PAGE, before });
        if (era !== epoch) return 0;
        const have = new Set(get().messages.map((m) => m.id));
        putMessages(page);
        return page.filter((m) => !have.has(m.id)).length;
      },

      async sendReply(to, body, context) {
        const api = apiFor(to);
        const era = epoch;
        const sent = await api.sendReply(to, body, context);
        if (era === epoch) putMessages([sent]);
        return sent;
      },

      async markThreadRead(personId) {
        const api = getApi();
        const mine = me();
        if (!api || !mine || !isUserId(personId)) return;
        const unread = get().messages.filter((m) => counterpart(m, mine) === personId && isUnreadForMe(m, mine));
        sink?.resolve(`activity:${personId}:`);
        if (unread.length === 0) return;
        const at = new Date(now()).toISOString();
        set((s) => ({ messages: s.messages.map((m) => (unread.some((u) => u.id === m.id) ? { ...m, readAt: at } : m)) }));
        try {
          await api.markRead({ with: personId });
        } catch {
          /* still unread on the server: it shows again next time; nothing to tell the person */
        }
      },

      setViewing(personId) {
        set({ viewing: personId });
        if (personId) void get().markThreadRead(personId);
      },

      noteRecent(track) {
        if (!track) return;
        set((s) => {
          const same = (t: Track) => t.source === track.source && t.title === track.title && t.artist === track.artist;
          if (s.recent[0] && same(s.recent[0])) return s;
          return { recent: [track, ...s.recent.filter((t) => !same(t))].slice(0, RECENT_MAX) };
        });
      },

      reset() {
        epoch++;
        stop();
        wanted.clear();
        engagementAt.clear();
        likes.clear();
        clearTimeout(engagementTimer);
        engagementTimer = undefined;
        feedPromise = null;
        feedAgain = false;
        unavailableUntil = 0;
        lastFeedTry = 0;
        demoLoaded = false;
        // the simulated people's notes stay known: they are not this account's data
        set((s) => ({ ...initial(), notes: Object.fromEntries(Object.entries(s.notes).filter(([id]) => !isUserId(id))) }));
      },

      async start() {
        const api = getApi();
        if (!api || unsubscribe) return;
        unsubscribe = api.subscribe(onEvent);
        sweepTimer ??= setInterval(sweep, SWEEP_MS);
        if (!removeListeners && typeof document !== 'undefined') {
          let at = now();
          const back = () => {
            if (visible() && now() - at >= RETRY_MS) {
              at = now();
              if (get().feedStatus === 'ready') void get().refreshFeed();
              void get().loadMessages();
            }
          };
          document.addEventListener('visibilitychange', back);
          window.addEventListener('focus', back);
          removeListeners = () => {
            document.removeEventListener('visibilitychange', back);
            window.removeEventListener('focus', back);
          };
        }
        await Promise.all([get().loadMine(), get().loadMessages()]);
      },
    };
  });
}

export const selectUnreadActivity = (me: string | null) => (s: Pick<ActivityState, 'messages'>) => (me ? unreadTotal(s.messages, me) : 0);
