/**
 * The small pure pieces the Activity UI and store share: what a "like" snapshot is made of, how long a note has left, how a message
 * reads in the bell and in a thread list, and how messages group into threads. Everything here treats its input as hostile text:
 * it is only ever cut, never interpreted.
 */
import { cleanText, parseTrack, type Track } from '@/features/nowplaying/track';
import { type ActivityMessage, COMMENT_MAX, type MessageContext, NOTE_MAX, type Note, type SubjectRef, trackKey } from './types';

export const refOfNote = (note: Pick<Note, 'id' | 'ownerId'>): SubjectRef => ({ ownerId: note.ownerId, kind: 'note', key: note.id });
export const refOfListening = (ownerId: string, track: Pick<Track, 'source' | 'title' | 'artist'>): SubjectRef => ({
  ownerId,
  kind: 'listening',
  key: trackKey(track),
});

/** What a like / comment on a note carries: the note as it is now, so it still makes sense after the note expires. */
export function contextOfNote(note: Pick<Note, 'text' | 'track'>): MessageContext {
  const ctx: MessageContext = { kind: 'note' };
  const text = cleanText(note.text, NOTE_MAX);
  if (text) ctx.text = text;
  const track = parseTrack(note.track);
  if (track) ctx.track = track;
  return ctx;
}

export function contextOfSong(track: Track): MessageContext {
  const ctx: MessageContext = { kind: 'listening' };
  const t = parseTrack(track);
  if (t) ctx.track = t;
  return ctx;
}

/** Cut to `max` characters with an ellipsis (never half an emoji). */
export function snippet(text: string, max: number): string {
  const flat = cleanText(text, 10_000);
  const chars = Array.from(flat);
  return chars.length <= max
    ? flat
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

/** "23h left", "45m left", "Less than a minute left", "Expired". */
export function timeLeft(expiresAt: string, now: number): string {
  const ms = Date.parse(expiresAt) - now;
  if (Number.isNaN(ms) || ms <= 0) return 'Expired';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'Less than a minute left';
  if (minutes < 60) return `${minutes}m left`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h < 6 && m > 0 ? `${h}h ${m}m left` : `${h}h left`;
}

/** The song line: "Midnight City · M83" (or just the title). */
export function songLine(track: Pick<Track, 'title' | 'artist'>): string {
  return track.artist ? `${track.title} · ${track.artist}` : track.title;
}

/** What a snapshot says in words: the note's text, or the song. */
export function contextLine(ctx: MessageContext | null): string {
  if (!ctx) return '';
  const text = cleanText(ctx.text, NOTE_MAX);
  if (text) return text;
  const track = parseTrack(ctx.track);
  return track ? songLine(track) : '';
}

const subjectWord = (ctx: MessageContext | null) => (ctx?.kind === 'listening' ? 'song' : 'note');

/**
 * How an incoming activity message reads in the notification centre. `name` is the sender's display name (already clean or
 * not — it is cut and cleaned here again).
 */
export function noticeFor(m: Pick<ActivityMessage, 'kind' | 'body' | 'context'>, name: string): { title: string; body: string } {
  const who = snippet(name, 40) || 'Someone';
  const about = contextLine(m.context);
  const body = snippet(m.body, COMMENT_MAX);
  if (m.kind === 'like') return { title: `${who} liked your ${subjectWord(m.context)}`, body: about ? `“${snippet(about, 80)}”` : '' };
  if (m.kind === 'comment')
    return { title: `${who} commented: ${snippet(body, 80)}`, body: about ? `On your ${subjectWord(m.context)} “${snippet(about, 60)}”` : 'On your note' };
  return { title: `${who} replied: ${snippet(body, 80)}`, body: about ? `About your ${subjectWord(m.context)} “${snippet(about, 60)}”` : 'A private message' };
}

/** The one-line preview of a message in a thread list: "❤ liked your note", "You: thanks!", "Nice one". */
export function previewOf(m: ActivityMessage, me: string): string {
  const mine = m.senderId === me;
  if (m.kind === 'like') return mine ? `You liked their ${subjectWord(m.context)}` : `❤ liked your ${subjectWord(m.context)}`;
  const text = snippet(m.body, 70);
  return mine ? `You: ${text}` : text;
}

// ── threads ──

export type Thread = { personId: string; last: ActivityMessage; unread: number };

/** The other person in a message, from my point of view. */
export const counterpart = (m: Pick<ActivityMessage, 'senderId' | 'recipientId'>, me: string): string => (m.senderId === me ? m.recipientId : m.senderId);

export const isUnreadForMe = (m: ActivityMessage, me: string): boolean => m.recipientId === me && m.senderId !== me && m.readAt === null;

const newestFirst = (a: ActivityMessage, b: ActivityMessage) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

/** One thread per person, the most recently active first. */
export function buildThreads(messages: readonly ActivityMessage[], me: string): Thread[] {
  const byPerson = new Map<string, Thread>();
  for (const m of [...messages].sort(newestFirst)) {
    const personId = counterpart(m, me);
    const t = byPerson.get(personId);
    if (t) {
      if (isUnreadForMe(m, me)) t.unread += 1;
    } else {
      byPerson.set(personId, { personId, last: m, unread: isUnreadForMe(m, me) ? 1 : 0 });
    }
  }
  return [...byPerson.values()];
}

export const unreadTotal = (messages: readonly ActivityMessage[], me: string): number => messages.reduce((n, m) => (isUnreadForMe(m, me) ? n + 1 : n), 0);

/** Where a notification / link takes you: `#/chat/a:<personId>` opens that person's activity thread in Direct messages. */
const THREAD_LINK = /^a:(.{1,100})$/;
export const threadLink = (personId: string): string => `a:${personId}`;
export function threadFromSub(sub: string | null | undefined): string | null {
  const m = sub ? THREAD_LINK.exec(sub) : null;
  return m ? (m[1] as string) : null;
}

// ── errors, in words ──

/** What went wrong, in a sentence a person can act on. */
export function explainError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case 'unavailable':
      return 'Notes, hearts and messages aren’t available on this server yet.';
    case 'not_signed_in':
      return 'Sign in to do that.';
    case 'not_allowed':
      return 'That isn’t allowed right now — the note may have expired, or it isn’t shared with you.';
    case 'rate_limited':
      return 'You’re doing that a lot. Try again in a little while.';
    case 'invalid':
      return 'That text can’t be sent. Check the length and try again.';
    case 'network':
      return 'Couldn’t reach the server. Check your connection and try again.';
    default:
      return 'Something went wrong. Try again.';
  }
}

/**
 * What to tell someone whose heart didn't go through. A heart on a live song only works while it is still what that person is playing
 * (their Now playing row is fresh), so for a song "not allowed" means the song just changed — not that anything is wrong.
 */
export function heartFailure(err: unknown, kind: 'note' | 'listening'): { title: string; description: string } {
  const code = (err as { code?: string } | null)?.code;
  if (kind === 'listening' && code === 'not_allowed')
    return { title: 'That song just changed', description: 'A heart goes to what someone is listening to right now.' };
  return { title: 'Couldn’t update your heart', description: explainError(err) };
}
