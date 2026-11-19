/**
 * An in-memory "server" + per-user API that follows the contract's rules: notes live 24 hours and then vanish, text is capped
 * and cleaned, people only see what its owner lets them (`Visibility`), nobody likes their own note, a like is idempotent and a
 * re-like after an un-like never notifies twice, comments and private replies are capped, and `markRead` only ever touches what
 * was addressed to you. Used by tests, the dev harness and the SIMULATED people (see `demo.ts`) — never a real account.
 */
import { cleanText, parseTrack, type Track } from '@/features/nowplaying/track';
import type { ActivityApi, ActivityEvent } from './api';
import {
  ActivityError,
  type ActivityMessage,
  type ActivityMessageKind,
  COMMENT_MAX,
  type Comment,
  type Engagement,
  type FeedItem,
  MESSAGE_MAX,
  type MessageContext,
  NO_ENGAGEMENT,
  NOTE_MAX,
  NOTE_TTL_HOURS,
  type Note,
  refKey,
  type SubjectRef,
  type Visibility,
} from './types';

const HOUR = 3_600_000;
const FEED_DEFAULT = 40;
const FEED_MAX = 100;

type Sub = { viewer: string; cb: (e: ActivityEvent) => void };

export class MemoryActivityServer {
  /** The clock. Tests move it to expire notes. */
  now = () => Date.now();
  /** How long a note lives (24 h; the demo people's never expire so the demo never goes empty). */
  ttlMs = NOTE_TTL_HOURS * HOUR;
  /** Set false to see how the app behaves when the migration isn't applied. */
  available = true;
  /** Do `viewer` and `owner` share a community? (Default: everyone does.) */
  shares: (viewer: string, owner: string) => boolean = () => true;
  /** May `viewer` see what `owner` is listening to? (Live songs follow the Now playing rules, which the memory server doesn't model.) */
  hearing: (viewer: string, owner: string) => boolean = () => true;
  /** When set, the next write rejects with this (to exercise rollbacks). */
  failNext: ActivityError | null = null;

  visibility = new Map<string, Visibility>();
  notes = new Map<string, Note>();
  /** refKey → people who like it. */
  likes = new Map<string, Set<string>>();
  /** `liker|refKey` pairs that already produced a notification. */
  private notified = new Set<string>();
  comments: Comment[] = [];
  messages: ActivityMessage[] = [];
  subs = new Set<Sub>();
  private seq = 0;
  private stamp = 0;

  private id(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }
  /** ISO time that never repeats or runs backwards within the server, so ordering by it is strict. */
  private iso(): string {
    this.stamp = Math.max(this.now(), this.stamp + 1);
    return new Date(this.stamp).toISOString();
  }

  private live(n: Note | undefined): n is Note {
    return !!n && Date.parse(n.expiresAt) > this.now();
  }

  private notesVisibility(owner: string): Visibility {
    return this.visibility.get(owner) ?? 'communities';
  }

  /** May `viewer` see `owner`'s notes (and what hangs off them)? */
  canSee(viewer: string, owner: string): boolean {
    if (viewer === owner) return true;
    const v = this.notesVisibility(owner);
    return v === 'everyone' || (v === 'communities' && this.shares(viewer, owner));
  }

  /** May `viewer` react to this subject? Notes: it exists, hasn't expired, and is visible. Songs: the owner's song is visible. */
  private reachable(viewer: string, ref: SubjectRef): boolean {
    if (ref.kind === 'note') {
      const n = this.notes.get(ref.ownerId);
      return this.live(n) && n.id === ref.key && this.canSee(viewer, ref.ownerId);
    }
    return viewer === ref.ownerId || this.hearing(viewer, ref.ownerId);
  }

  private emit(e: ActivityEvent, to?: (viewer: string) => boolean) {
    for (const s of [...this.subs]) if (!to || to(s.viewer)) s.cb(e);
  }

  private engagementOf(viewer: string, ref: SubjectRef): Engagement {
    if (!this.reachable(viewer, ref)) return NO_ENGAGEMENT;
    const k = refKey(ref);
    const likes = this.likes.get(k);
    return { likes: likes?.size ?? 0, likedByMe: likes?.has(viewer) ?? false, comments: this.comments.filter((c) => refKey(c.ref) === k).length };
  }

  private pushMessage(m: Omit<ActivityMessage, 'id' | 'createdAt' | 'readAt'>): ActivityMessage {
    const msg: ActivityMessage = { ...m, id: this.id('msg'), createdAt: this.iso(), readAt: null };
    this.messages.push(msg);
    this.emit({ type: 'message', message: msg }, (v) => v === msg.recipientId);
    return msg;
  }

  private cleanContext(c: MessageContext | null): MessageContext | null {
    if (!c) return null;
    const out: MessageContext = { kind: c.kind === 'listening' ? 'listening' : 'note' };
    const text = cleanText(c.text, NOTE_MAX);
    if (text) out.text = text;
    const track = parseTrack(c.track);
    if (track) out.track = track;
    return out;
  }

  // ── seeding helpers (tests, harness, demo) ──

  /** Put a note in place as if `owner` had just posted it, `ageMs` ago. */
  seedNote(owner: string, text: string, track: Track | null = null, ageMs = 0, visibility?: Visibility): Note {
    if (visibility) this.visibility.set(owner, visibility);
    const created = this.now() - ageMs;
    const note: Note = {
      id: this.id('note'),
      ownerId: owner,
      text: cleanText(text, NOTE_MAX),
      track: parseTrack(track),
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + this.ttlMs).toISOString(),
    };
    this.notes.set(owner, note);
    this.emit({ type: 'note', ownerId: owner }, (v) => this.canSee(v, owner));
    return note;
  }

  /** Make `by` like `ref` without any notification (seed data). */
  seedLike(ref: SubjectRef, by: string): void {
    const k = refKey(ref);
    const set = this.likes.get(k) ?? new Set<string>();
    set.add(by);
    this.likes.set(k, set);
    this.notified.add(`${by}|${k}`);
  }

  seedComment(ref: SubjectRef, by: string, body: string, ageMs = 0): Comment {
    const c: Comment = { id: this.id('c'), ref, authorId: by, body: cleanText(body, COMMENT_MAX), createdAt: new Date(this.now() - ageMs).toISOString() };
    this.comments.push(c);
    return c;
  }

  // ── the API ──

  api(me: string): ActivityApi {
    const need = () => {
      if (!this.available) throw new ActivityError('unavailable');
    };
    const write = () => {
      need();
      const f = this.failNext;
      if (f) {
        this.failNext = null;
        throw f;
      }
    };
    const must = (ref: SubjectRef) => {
      if (!this.reachable(me, ref)) throw new ActivityError('not_allowed');
    };
    /** Comments hang under a NOTE (a live song has nothing for them to stay attached to). */
    const mustNote = (ref: SubjectRef) => {
      if (ref.kind !== 'note') throw new ActivityError('invalid', 'Only notes have comments.');
      must(ref);
    };

    return {
      me,

      getMyNote: async () => {
        need();
        const n = this.notes.get(me);
        return this.live(n) ? n : null;
      },

      postNote: async ({ text, track }) => {
        write();
        const clean = cleanText(text, 1000);
        const t = parseTrack(track);
        if (clean.length > NOTE_MAX || (clean.length === 0 && !t)) throw new ActivityError('invalid');
        if (this.notesVisibility(me) === 'off') throw new ActivityError('not_allowed');
        const created = this.now();
        const note: Note = {
          id: this.id('note'),
          ownerId: me,
          text: clean,
          track: t,
          createdAt: new Date(created).toISOString(),
          expiresAt: new Date(created + this.ttlMs).toISOString(),
        };
        this.notes.set(me, note);
        this.emit({ type: 'note', ownerId: me }, (v) => this.canSee(v, me));
        return note;
      },

      deleteMyNote: async () => {
        write();
        if (this.notes.delete(me)) this.emit({ type: 'note', ownerId: me }, (v) => this.canSee(v, me));
      },

      getNotesVisibility: async () => {
        need();
        return this.notesVisibility(me);
      },

      setNotesVisibility: async (v) => {
        write();
        this.visibility.set(me, v);
        if (v === 'off' && this.notes.delete(me)) this.emit({ type: 'note', ownerId: me }, (viewer) => viewer !== me);
      },

      feed: async (opts = {}) => {
        need();
        const limit = Math.min(Math.max(1, opts.limit ?? FEED_DEFAULT), FEED_MAX);
        const items: FeedItem[] = [];
        for (const n of this.notes.values()) {
          if (!this.live(n) || !this.canSee(me, n.ownerId)) continue;
          if (opts.before && n.createdAt >= opts.before) continue;
          const ref: SubjectRef = { ownerId: n.ownerId, kind: 'note', key: n.id };
          items.push({ kind: 'note', ref, at: n.createdAt, note: n, engagement: this.engagementOf(me, ref) });
        }
        return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
      },

      engagement: async (refs) => {
        need();
        return Object.fromEntries(refs.map((r) => [refKey(r), this.engagementOf(me, r)]));
      },

      like: async (ref, context) => {
        write();
        if (ref.ownerId === me) throw new ActivityError('not_allowed', 'You can’t like your own note.');
        must(ref);
        const k = refKey(ref);
        const set = this.likes.get(k) ?? new Set<string>();
        if (set.has(me)) return; // liking twice is a no-op
        set.add(me);
        this.likes.set(k, set);
        this.emit({ type: 'engagement', ref }, (v) => this.reachable(v, ref));
        if (!this.notified.has(`${me}|${k}`)) {
          this.notified.add(`${me}|${k}`);
          this.pushMessage({ senderId: me, recipientId: ref.ownerId, kind: 'like', body: '', context: this.cleanContext(context) });
        }
      },

      unlike: async (ref) => {
        write();
        if (this.likes.get(refKey(ref))?.delete(me)) this.emit({ type: 'engagement', ref }, (v) => this.reachable(v, ref));
      },

      comments: async (ref, opts = {}) => {
        need();
        mustNote(ref);
        const limit = Math.min(Math.max(1, opts.limit ?? 50), 100);
        const k = refKey(ref);
        return this.comments
          .filter((c) => refKey(c.ref) === k && (!opts.before || c.createdAt < opts.before))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
          .slice(0, limit);
      },

      addComment: async (ref, body, context) => {
        write();
        const clean = cleanText(body, 1000);
        if (!clean || clean.length > COMMENT_MAX) throw new ActivityError('invalid');
        mustNote(ref);
        const c: Comment = { id: this.id('c'), ref, authorId: me, body: clean, createdAt: this.iso() };
        this.comments.push(c);
        this.emit({ type: 'engagement', ref }, (v) => this.reachable(v, ref));
        if (ref.ownerId !== me) this.pushMessage({ senderId: me, recipientId: ref.ownerId, kind: 'comment', body: clean, context: this.cleanContext(context) });
        return c;
      },

      deleteComment: async (id) => {
        write();
        const c = this.comments.find((x) => x.id === id);
        if (!c) return;
        if (c.authorId !== me && c.ref.ownerId !== me) throw new ActivityError('not_allowed');
        this.comments = this.comments.filter((x) => x.id !== id);
        this.emit({ type: 'engagement', ref: c.ref }, (v) => this.reachable(v, c.ref));
      },

      messages: async (opts = {}) => {
        need();
        const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
        return this.messages
          .filter((m) => {
            const mine = m.senderId === me || m.recipientId === me;
            if (!mine || (opts.before && m.createdAt >= opts.before)) return false;
            return !opts.with || m.senderId === opts.with || m.recipientId === opts.with;
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
          .slice(0, limit);
      },

      sendReply: async (to, body, context) => {
        write();
        const clean = cleanText(body, 2000);
        if (!clean || clean.length > MESSAGE_MAX || to === me) throw new ActivityError('invalid');
        const wroteToMe = this.messages.some((m) => m.senderId === to && m.recipientId === me);
        if (!this.canSee(me, to) && !wroteToMe) throw new ActivityError('not_allowed');
        const kind: ActivityMessageKind = 'reply';
        return this.pushMessage({ senderId: me, recipientId: to, kind, body: clean, context: this.cleanContext(context) });
      },

      markRead: async (target) => {
        need();
        const at = this.iso();
        for (const m of this.messages) {
          if (m.recipientId !== me || m.readAt) continue;
          if ('ids' in target ? target.ids.includes(m.id) : m.senderId === target.with) m.readAt = at;
        }
      },

      subscribe: (onEvent) => {
        const sub: Sub = { viewer: me, cb: onEvent };
        this.subs.add(sub);
        return () => void this.subs.delete(sub);
      },
    };
  }
}
