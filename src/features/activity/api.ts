import type { Track } from '@/features/nowplaying/track';
import type { ActivityMessage, Comment, Engagement, FeedItem, MessageContext, Note, SubjectRef, Visibility } from './types';

/** A live change the UI reacts to. */
export type ActivityEvent = { type: 'message'; message: ActivityMessage } | { type: 'note'; ownerId: string } | { type: 'engagement'; ref: SubjectRef };

/**
 * What the app needs from a backend for Activity. `supabaseApi` is the real thing (Supabase tables + RLS + Realtime);
 * `memoryApi` is an in-memory stand-in for tests, the dev harness and the demo people. Both enforce the same rules:
 * people only see the notes / songs of those who let them (see `Visibility`), notes expire after 24 hours, text is length-capped.
 */
export interface ActivityApi {
  /** The signed-in user's id. */
  readonly me: string;

  // ── my note ──
  getMyNote(): Promise<Note | null>;
  /** Replaces my current note; starts a fresh 24 hours. `text` ≤ NOTE_MAX; empty text needs a track. Needs notes visibility ≠ off. */
  postNote(input: { text: string; track: Track | null }): Promise<Note>;
  deleteMyNote(): Promise<void>;
  /** Who may see my notes (and likes/comments on them). Rejects with `unavailable` when the database lacks the setting (migration not applied). */
  getNotesVisibility(): Promise<Visibility>;
  setNotesVisibility(v: Visibility): Promise<void>;

  // ── the feed ──
  /** Notes (not expired) of the people I may see, newest first. `before` = ISO createdAt of the last item you already have. Includes mine. */
  feed(opts?: { limit?: number; before?: string }): Promise<FeedItem[]>;
  /** Likes / comments counts and whether I liked, for these subjects (any mix of notes and live songs). Keyed by `refKey`. */
  engagement(refs: SubjectRef[]): Promise<Record<string, Engagement>>;

  // ── likes (a heart) ──
  /**
   * Like a note or a live song. The owner is notified and gets an activity message carrying `context` (the snapshot that was
   * liked). Liking twice is a no-op; a re-like after an un-like does not notify again.
   */
  like(ref: SubjectRef, context: MessageContext): Promise<void>;
  unlike(ref: SubjectRef): Promise<void>;

  // ── comments (public, under a note) ──
  comments(ref: SubjectRef, opts?: { limit?: number; before?: string }): Promise<Comment[]>;
  /** Also notifies the note's owner (an activity message of kind `comment`). */
  addComment(ref: SubjectRef, body: string, context: MessageContext): Promise<Comment>;
  /** Mine, or any comment on my own note. */
  deleteComment(id: string): Promise<void>;

  // ── activity messages (the small real inbox) ──
  /** Newest first. `with` = only the thread with that person (messages both ways). */
  messages(opts?: { with?: string; limit?: number; before?: string }): Promise<ActivityMessage[]>;
  /** A private reply (text ≤ MESSAGE_MAX), optionally about a note / song. Allowed to people I may see, or who already wrote to me. */
  sendReply(to: string, body: string, context: MessageContext | null): Promise<ActivityMessage>;
  /** Mark these messages (or a whole thread) as read — only ever the ones addressed to me. */
  markRead(target: { ids: string[] } | { with: string }): Promise<void>;
  /** Live changes. Returns the unsubscribe function. */
  subscribe(onEvent: (e: ActivityEvent) => void): () => void;
}
