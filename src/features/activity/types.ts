/**
 * Activity — what people in your communities are up to, and how you react to it.
 *
 *   * **Notes**: a short line (and/or a song) a person pins for 24 hours, like Instagram Notes. Explicitly posted, so it may be kept
 *     for a day (unlike the live "listening now" row, which has no history).
 *   * **Listening now**: the live Now playing row from `features/nowplaying` (ephemeral; shown in the feed while it is fresh).
 *   * **Likes**: a heart on a note or on the song someone is listening to. The owner gets a notification AND an activity message
 *     (it carries a snapshot of the note / song that was liked, so it still makes sense after the note expires or the song changes).
 *   * **Comments**: public replies under a note (people who can see the note can read them).
 *   * **Activity messages**: the small real inbox this feature adds — likes, comments and private replies, each with the context
 *     snapshot — shown in the bell and as threads in Direct messages. (Direct messages between demo friends are still simulated;
 *     a full real DM backend is a separate, later project. Activity messages ARE real and cross-user.)
 *
 * This file is the CONTRACT between the data layer (`supabaseApi.ts` / `memoryApi.ts`) and the UI. Everything a backend hands back
 * has already been cleaned (`cleanText`, tracks through `parseTrack`) and is only ever rendered as TEXT.
 */
import type { Visibility } from '@/features/nowplaying/protocol';
import type { Track } from '@/features/nowplaying/track';

export const NOTE_MAX = 60;
export const COMMENT_MAX = 200;
export const MESSAGE_MAX = 500;
export const NOTE_TTL_HOURS = 24;

export type SubjectKind = 'note' | 'listening';

/** What a like / comment points at. `key` is the note's id, or — for a live song — `trackKey(track)`. */
export type SubjectRef = { ownerId: string; kind: SubjectKind; key: string };

/** Stable string form of a ref (map keys, React keys). */
export const refKey = (r: SubjectRef): string => `${r.ownerId}|${r.kind}|${r.key}`;

/** A stable key for "this song" — lower-cased source|title|artist, trimmed, at most 200 characters. */
export function trackKey(t: Pick<Track, 'source' | 'title' | 'artist'>): string {
  return `${t.source}|${t.title}|${t.artist}`.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
}

export type Note = {
  id: string;
  ownerId: string;
  /** ≤ NOTE_MAX characters; may be empty only when `track` is set (a song-only note). */
  text: string;
  /** A song pinned to the note (explicitly chosen — usually the one playing when it was posted), or null. */
  track: Track | null;
  createdAt: string;
  /** Server-set: createdAt + 24 h. Expired notes are never returned. */
  expiresAt: string;
};

export type Engagement = { likes: number; likedByMe: boolean; comments: number };
export const NO_ENGAGEMENT: Engagement = { likes: 0, likedByMe: false, comments: 0 };

export type FeedItem =
  | { kind: 'note'; ref: SubjectRef; at: string; note: Note; engagement: Engagement }
  | { kind: 'listening'; ref: SubjectRef; at: string; track: Track; engagement: Engagement };

export type Comment = { id: string; ref: SubjectRef; authorId: string; body: string; createdAt: string };

/** A snapshot of what was liked / replied to, stored with the message so it keeps its meaning. */
export type MessageContext = { kind: SubjectKind; text?: string; track?: Track };

export type ActivityMessageKind = 'like' | 'comment' | 'reply';
export type ActivityMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  kind: ActivityMessageKind;
  /** The comment / reply text (empty for a like). */
  body: string;
  context: MessageContext | null;
  createdAt: string;
  /** Set (by the recipient) when seen; null while unread. */
  readAt: string | null;
};

export class ActivityError extends Error {
  constructor(
    public code: 'unavailable' | 'not_signed_in' | 'not_allowed' | 'rate_limited' | 'invalid' | 'network',
    message?: string,
  ) {
    super(message ?? code);
  }
}

export type { Visibility };
