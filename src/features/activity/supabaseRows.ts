/**
 * Rows from the database (and Realtime events) → the app's Activity types. Everything here is "never throw, return null": a row
 * came from a server we ask politely but do not trust, and it may carry text a stranger typed. So every id must look like an id,
 * every text goes through `cleanText` (control / invisible / bidi characters become spaces, length capped), every song through
 * the Now playing allow-list (`trackFromRow` / `parseTrack`), and anything that fails is dropped rather than shown.
 *
 * Nothing here ever becomes HTML: the results are rendered as text only.
 */
import { isUserId } from '@/features/nowplaying/api';
import { cleanText, parseTrack, trackFromRow } from '@/features/nowplaying/track';
import {
  type ActivityMessage,
  type ActivityMessageKind,
  COMMENT_MAX,
  type Comment,
  type Engagement,
  MESSAGE_MAX,
  type MessageContext,
  NOTE_MAX,
  type Note,
  type SubjectKind,
  type SubjectRef,
} from './types';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An account / row id (a UUID). */
export const isId = (v: unknown): v is string => typeof v === 'string' && isUserId(v);

export const isSubjectKind = (v: unknown): v is SubjectKind => v === 'note' || v === 'listening';

/** The longest a subject key may be (the database agrees). */
export const KEY_MAX = 200;
export const isSubjectKey = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= KEY_MAX;

/**
 * A timestamp as the server wrote it, or null. Kept as the server's own string (not re-formatted through `Date`) because paging
 * sends it back as `before`, and the database's microseconds would be lost by `toISOString()` — which could skip a row.
 */
export function timestamp(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/.test(s)) return null;
  s = s.replace(' ', 'T');
  if (/[+-]\d{2}$/.test(s)) s += ':00';
  return Number.isNaN(Date.parse(s)) ? null : s;
}

/** A count from the server: a whole number, never negative, never absurd. */
export function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(Math.trunc(v), 0), 1_000_000) : 0;
}

/** The snapshot of what a like / reply was about, cleaned. Null when it isn't one. */
export function parseContext(raw: unknown): MessageContext | null {
  if (!isRecord(raw) || !isSubjectKind(raw.kind)) return null;
  const context: MessageContext = { kind: raw.kind };
  const text = cleanText(raw.text, NOTE_MAX);
  if (text) context.text = text;
  const track = parseTrack(raw.track);
  if (track) context.track = track;
  return context;
}

/**
 * What goes to the database as a snapshot: the kind comes from the SUBJECT (so the two can't disagree), the text is cleaned and
 * capped, the song goes through the allow-list. (For a heart the database replaces it with the real note / song anyway.)
 */
export function contextForDb(kind: SubjectKind, context: MessageContext | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { kind };
  const text = cleanText(context?.text, NOTE_MAX);
  if (text) out.text = text;
  const track = parseTrack(context?.track);
  if (track) out.track = track;
  return out;
}

/** A row of `status_notes` (or of `activity_feed`, which adds the counts). */
export function parseNoteRow(raw: unknown): Note | null {
  if (!isRecord(raw) || !isId(raw.id) || !isId(raw.user_id)) return null;
  const text = cleanText(raw.body, NOTE_MAX);
  const track =
    raw.track_title == null
      ? null
      : trackFromRow({
          title: raw.track_title,
          artist: raw.track_artist,
          album: raw.track_album,
          artwork_url: raw.track_artwork_url,
          track_url: raw.track_url,
          source: raw.track_source,
        });
  const createdAt = timestamp(raw.created_at);
  const expiresAt = timestamp(raw.expires_at);
  if ((!text && !track) || !createdAt || !expiresAt) return null;
  return { id: raw.id, ownerId: raw.user_id, text, track, createdAt, expiresAt };
}

export function parseEngagement(raw: unknown): Engagement {
  const r = isRecord(raw) ? raw : {};
  return { likes: count(r.likes), likedByMe: r.liked_by_me === true, comments: count(r.comments) };
}

export function parseCommentRow(raw: unknown): Comment | null {
  if (!isRecord(raw) || !isId(raw.id) || !isId(raw.owner_id) || !isId(raw.author_id) || !isSubjectKey(raw.subject_key)) return null;
  const body = cleanText(raw.body, COMMENT_MAX);
  const createdAt = timestamp(raw.created_at);
  if (!body || !createdAt) return null;
  return { id: raw.id, ref: { ownerId: raw.owner_id, kind: 'note', key: raw.subject_key }, authorId: raw.author_id, body, createdAt };
}

const MESSAGE_KINDS: readonly string[] = ['like', 'comment', 'reply'];

/** A row of `activity_messages`. It must be between two different accounts, one of them `me`. */
export function parseMessageRow(raw: unknown, me: string): ActivityMessage | null {
  if (!isRecord(raw) || !isId(raw.id) || !isId(raw.sender_id) || !isId(raw.recipient_id)) return null;
  if (raw.sender_id === raw.recipient_id || (raw.sender_id !== me && raw.recipient_id !== me)) return null;
  if (typeof raw.kind !== 'string' || !MESSAGE_KINDS.includes(raw.kind)) return null;
  const kind = raw.kind as ActivityMessageKind;
  const body = kind === 'like' ? '' : cleanText(raw.body, MESSAGE_MAX);
  const createdAt = timestamp(raw.created_at);
  if (!createdAt || (kind !== 'like' && !body)) return null;
  return {
    id: raw.id,
    senderId: raw.sender_id,
    recipientId: raw.recipient_id,
    kind,
    body,
    context: parseContext(raw.context),
    createdAt,
    readAt: timestamp(raw.read_at),
  };
}

export const NOTE_COLUMNS = 'id, user_id, body, track_title, track_artist, track_album, track_artwork_url, track_url, track_source, created_at, expires_at';
export const COMMENT_COLUMNS = 'id, owner_id, subject_key, author_id, body, created_at';
export const MESSAGE_COLUMNS = 'id, sender_id, recipient_id, kind, body, context, created_at, read_at';

/** Is this a ref the database could hold? (Anything else is refused before a request is made.) */
export function isRef(r: SubjectRef): boolean {
  return isId(r.ownerId) && isSubjectKind(r.kind) && isSubjectKey(r.key) && (r.kind !== 'note' || isId(r.key));
}
