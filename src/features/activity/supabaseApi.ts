/**
 * The real data layer for Activity: the `status_notes`, `activity_likes`, `activity_comments` and `activity_messages` tables and
 * the `activity_feed` / `activity_engagement` functions (every rule — who may see what, expiry, rate limits, what a row may hold,
 * that a like or a comment can only come from its own trigger — is in the database:
 * supabase/migrations/20261120000000_activity.sql; this file only shapes requests), plus Realtime for live changes.
 *
 * What comes back is cleaned before anyone sees it (`supabaseRows.ts`) and only ever rendered as text. Database refusals become
 * `ActivityError`s with a code the UI can act on; a project that hasn't had the migration yet answers `unavailable`.
 *
 * Choices worth knowing (the contract in api.ts leaves them open):
 *   • `comments()` and `messages()` are NEWEST FIRST and `before` means "older than this createdAt" — the same as `feed()`.
 *     `messages()` without `with` returns everything I am a party to, both directions.
 *   • `like(ref, context)` and `addComment(ref, body, context)`: the database builds the snapshot the owner is told about itself — from
 *     the note, or from the song the owner is playing right now — so `context` is only sent (cleaned) as the caller's claim and is
 *     never what is stored; it can't make a message say something that wasn't liked.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isVisibility } from '@/features/nowplaying/protocol';
import { cleanText, parseTrack } from '@/features/nowplaying/track';
import { supabase } from '@/lib/supabase/client';
import type { ActivityApi, ActivityEvent } from './api';
import {
  COMMENT_COLUMNS,
  contextForDb,
  isId,
  isRef,
  MESSAGE_COLUMNS,
  NOTE_COLUMNS,
  parseCommentRow,
  parseEngagement,
  parseMessageRow,
  parseNoteRow,
  timestamp,
} from './supabaseRows';
import {
  ActivityError,
  type ActivityMessage,
  COMMENT_MAX,
  type Comment,
  type Engagement,
  type FeedItem,
  MESSAGE_MAX,
  NOTE_MAX,
  refKey,
  type SubjectRef,
} from './types';

function client(): SupabaseClient {
  if (!supabase) throw new ActivityError('unavailable', 'Accounts aren’t set up in this build.');
  return supabase;
}

type DbError = { code?: string; message?: string; status?: number } | null;

/** The migration isn't applied to this project yet (no such table / function / column). */
const isMissing = (e: DbError) =>
  !!e &&
  (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(e.code ?? '') ||
    /does not exist|schema cache|could not find/i.test(e.message ?? ''));
const isNetwork = (e: DbError) => /failed to fetch|network|load failed|fetch failed/i.test(e?.message ?? '');

/** What a database refusal means to the person. Order matters: the more specific rules first. */
export function toActivityError(e: NonNullable<DbError>): ActivityError {
  const code = e.code ?? '';
  const message = e.message ?? '';
  if (/rate_limited/.test(message) || e.status === 429) return new ActivityError('rate_limited', message);
  if (isMissing(e)) return new ActivityError('unavailable', message);
  if (code === 'PGRST301' || e.status === 401 || /\bjwt\b/i.test(message)) return new ActivityError('not_signed_in', message);
  // Row-level security (and a missing column grant) both answer 42501: "you may not".
  if (code === '42501' || e.status === 403 || /row-level security|permission denied|immutable_column/i.test(message))
    return new ActivityError('not_allowed', message);
  // A check, not-null, foreign-key or malformed-value violation: what was sent isn't something the database will hold.
  if (/^(23|22)/.test(code)) return new ActivityError('invalid', message);
  if (isNetwork(e)) return new ActivityError('network', message);
  return new ActivityError('unavailable', message);
}

const fail = (e: NonNullable<DbError>): never => {
  throw toActivityError(e);
};

const clamp = (v: number | undefined, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(Math.trunc(v), min), max) : fallback;

/** A `before` cursor: the createdAt of the last item the caller has. Garbage is refused, not ignored (ignoring it would re-send page one). */
function cursor(before: string | undefined): string | null {
  if (before === undefined) return null;
  const ts = timestamp(before);
  if (!ts) throw new ActivityError('invalid', 'Bad "before" cursor.');
  return ts;
}

const ENGAGEMENT_BATCH = 100;
const ENGAGEMENT_MAX = 300;

let channelSeq = 0;

export function createSupabaseActivityApi(me: string): ActivityApi {
  const note = async () => {
    const { data, error } = await client().from('status_notes').select(NOTE_COLUMNS).eq('user_id', me).maybeSingle();
    if (error) return fail(error);
    return parseNoteRow(data);
  };

  return {
    me,

    // ── my note ──
    getMyNote: note,

    async postNote({ text, track }) {
      const body = cleanText(text, NOTE_MAX);
      const song = track ? parseTrack(track) : null;
      if (!body && !song) throw new ActivityError('invalid', 'A note needs some words or a song.');
      // Every column is sent every time, so posting a text-only note after a song note really drops the song.
      const row = {
        user_id: me,
        body,
        track_title: song?.title ?? null,
        track_artist: song ? song.artist : null,
        track_album: song ? song.album : null,
        track_artwork_url: song?.artworkUrl ?? null,
        track_url: song?.trackUrl ?? null,
        track_source: song?.source ?? null,
      };
      const { data, error } = await client().from('status_notes').upsert(row, { onConflict: 'user_id' }).select(NOTE_COLUMNS).single();
      if (error) return fail(error);
      const posted = parseNoteRow(data);
      if (!posted) throw new ActivityError('unavailable', 'The server sent back a note that could not be read.');
      return posted;
    },

    async deleteMyNote() {
      const { error } = await client().from('status_notes').delete().eq('user_id', me);
      if (error) fail(error);
    },

    async getNotesVisibility() {
      const { data, error } = await client().from('profiles').select('notes_visibility').eq('id', me).maybeSingle();
      if (error) return fail(error);
      const v = (data as { notes_visibility?: unknown } | null)?.notes_visibility;
      return isVisibility(v) ? v : 'communities';
    },

    async setNotesVisibility(v) {
      if (!isVisibility(v)) throw new ActivityError('invalid');
      const { error } = await client().from('profiles').update({ notes_visibility: v }).eq('id', me);
      if (error) fail(error);
    },

    // ── the feed ──
    async feed(opts) {
      const { data, error } = await client().rpc('activity_feed', { p_limit: clamp(opts?.limit, 1, 50, 30), p_before: cursor(opts?.before) });
      if (error) return fail(error);
      const items: FeedItem[] = [];
      const seen = new Set<string>();
      for (const row of Array.isArray(data) ? (data as unknown[]) : []) {
        const n = parseNoteRow(row);
        if (!n || seen.has(n.id)) continue;
        seen.add(n.id);
        items.push({ kind: 'note', ref: { ownerId: n.ownerId, kind: 'note', key: n.id }, at: n.createdAt, note: n, engagement: parseEngagement(row) });
      }
      return items;
    },

    async engagement(refs) {
      const valid = new Map<string, SubjectRef>();
      for (const r of refs) if (isRef(r) && valid.size < ENGAGEMENT_MAX) valid.set(refKey(r), { ownerId: r.ownerId, kind: r.kind, key: r.key });
      const out: Record<string, Engagement> = {};
      const list = [...valid.values()];
      if (list.length === 0) return out;
      const batches: SubjectRef[][] = [];
      for (let i = 0; i < list.length; i += ENGAGEMENT_BATCH) batches.push(list.slice(i, i + ENGAGEMENT_BATCH));
      const c = client();
      const answers = await Promise.all(
        batches.map((batch) => c.rpc('activity_engagement', { p_refs: batch.map((r) => ({ owner_id: r.ownerId, kind: r.kind, subject_key: r.key })) })),
      );
      for (const { data, error } of answers) {
        if (error) return fail(error);
        for (const row of Array.isArray(data) ? (data as Array<Record<string, unknown> | null>) : []) {
          if (typeof row !== 'object' || row === null) continue;
          // only what was asked for: a row for a subject nobody asked about is ignored
          const key = refKey({ ownerId: String(row.owner_id), kind: row.kind as SubjectRef['kind'], key: String(row.subject_key) });
          if (valid.has(key)) out[key] = parseEngagement(row);
        }
      }
      // A subject the database didn't answer for isn't one the caller may see (or has nothing yet): no hearts, no comments.
      for (const key of valid.keys()) out[key] ??= parseEngagement(null);
      return out;
    },

    // ── likes ──
    async like(ref, context) {
      if (!isRef(ref)) throw new ActivityError('invalid', 'Not something that can be liked.');
      if (ref.ownerId === me) throw new ActivityError('not_allowed', 'You can’t like your own.');
      const { error } = await client()
        .from('activity_likes')
        .insert({ owner_id: ref.ownerId, kind: ref.kind, subject_key: ref.key, context: contextForDb(ref.kind, context) });
      // 23505 = already liked: liking twice is a no-op, and the owner isn't told twice.
      if (error && error.code !== '23505') fail(error);
    },

    async unlike(ref) {
      if (!isRef(ref)) throw new ActivityError('invalid');
      const { error } = await client()
        .from('activity_likes')
        .delete()
        .eq('actor_id', me)
        .eq('owner_id', ref.ownerId)
        .eq('kind', ref.kind)
        .eq('subject_key', ref.key);
      if (error) fail(error);
    },

    // ── comments ──
    async comments(ref, opts) {
      if (!isRef(ref) || ref.kind !== 'note') return []; // comments live under notes only
      let query = client()
        .from('activity_comments')
        .select(COMMENT_COLUMNS)
        .eq('owner_id', ref.ownerId)
        .eq('subject_key', ref.key)
        .order('created_at', { ascending: false })
        .limit(clamp(opts?.limit, 1, 100, 50));
      const before = cursor(opts?.before);
      if (before) query = query.lt('created_at', before);
      const { data, error } = await query;
      if (error) return fail(error);
      const list: Comment[] = [];
      for (const row of Array.isArray(data) ? (data as unknown[]) : []) {
        const c = parseCommentRow(row);
        // the rows were asked for under this note; one that says it belongs elsewhere is not shown here
        if (c && c.ref.ownerId === ref.ownerId && c.ref.key === ref.key) list.push(c);
      }
      return list;
    },

    async addComment(ref, body) {
      if (!isRef(ref) || ref.kind !== 'note') throw new ActivityError('invalid', 'Comments go under notes.');
      const text = cleanText(body, COMMENT_MAX);
      if (!text) throw new ActivityError('invalid', 'A comment needs some words.');
      // the note's owner is notified by the database, with a snapshot of the note taken there
      const { data, error } = await client()
        .from('activity_comments')
        .insert({ owner_id: ref.ownerId, subject_key: ref.key, body: text })
        .select(COMMENT_COLUMNS)
        .single();
      if (error) return fail(error);
      const comment = parseCommentRow(data);
      if (!comment) throw new ActivityError('unavailable', 'The server sent back a comment that could not be read.');
      return comment;
    },

    async deleteComment(id) {
      if (!isId(id)) throw new ActivityError('invalid');
      // RLS lets only the author, or the owner of the note, delete a comment
      const { error } = await client().from('activity_comments').delete().eq('id', id);
      if (error) fail(error);
    },

    // ── activity messages ──
    async messages(opts) {
      const other = opts?.with;
      if (other !== undefined && !isId(other)) return []; // a demo person has no account, so nothing real was ever said with them
      if (other && !isId(me)) return []; // (the filter below is built from both ids: only ever UUIDs)
      let query = client()
        .from('activity_messages')
        .select(MESSAGE_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(clamp(opts?.limit, 1, 100, 50));
      // both ids are UUIDs (checked above and by Supabase's own auth), so they can't carry filter syntax
      if (other) query = query.or(`and(sender_id.eq.${me},recipient_id.eq.${other}),and(sender_id.eq.${other},recipient_id.eq.${me})`);
      const before = cursor(opts?.before);
      if (before) query = query.lt('created_at', before);
      const { data, error } = await query;
      if (error) return fail(error);
      const list: ActivityMessage[] = [];
      for (const row of Array.isArray(data) ? (data as unknown[]) : []) {
        const m = parseMessageRow(row, me);
        if (!m) continue;
        if (other && m.senderId !== other && m.recipientId !== other) continue;
        list.push(m);
      }
      return list;
    },

    async sendReply(to, body, context) {
      if (!isId(to)) throw new ActivityError('invalid', 'That person has no account to write to.');
      if (to === me) throw new ActivityError('not_allowed', 'You can’t write to yourself.');
      const text = cleanText(body, MESSAGE_MAX);
      if (!text) throw new ActivityError('invalid', 'A reply needs some words.');
      const { data, error } = await client()
        .from('activity_messages')
        .insert({ recipient_id: to, body: text, context: context ? contextForDb(context.kind, context) : null })
        .select(MESSAGE_COLUMNS)
        .single();
      if (error) return fail(error);
      const sent = parseMessageRow(data, me);
      if (!sent) throw new ActivityError('unavailable', 'The server sent back a message that could not be read.');
      return sent;
    },

    async markRead(target) {
      // Work out what to mark BEFORE building a request: nothing valid means nothing is sent.
      const ids = 'ids' in target ? target.ids.filter(isId).slice(0, 200) : [];
      const thread = 'with' in target && isId(target.with) ? target.with : null;
      if (ids.length === 0 && !thread) return;
      let query = client().from('activity_messages').update({ read_at: new Date().toISOString() }).eq('recipient_id', me).is('read_at', null);
      query = thread ? query.eq('sender_id', thread) : query.in('id', ids);
      const { error } = await query;
      if (error) fail(error);
    },

    // ── live changes ──
    subscribe(onEvent) {
      if (!supabase || !isId(me)) return () => {};
      const c = supabase;
      let live = true;
      const emit = (e: ActivityEvent | null) => {
        if (!live || !e) return;
        try {
          onEvent(e);
        } catch {
          /* a listener's mistake must not close the channel */
        }
      };
      const channel = c
        .channel(`activity:${++channelSeq}`)
        // New things written to me. RLS only sends rows I could select; the filter keeps it to mine.
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_messages', filter: `recipient_id=eq.${me}` }, (p) => {
          const message = parseMessageRow(p.new, me);
          emit(message && message.recipientId === me ? { type: 'message', message } : null);
        })
        // Notes of the people I may see (RLS decides which events arrive). A removal carries only the owner's id.
        .on('postgres_changes', { event: '*', schema: 'public', table: 'status_notes' }, (p) => {
          const row = (p.eventType === 'DELETE' ? p.old : p.new) as { user_id?: unknown } | null;
          emit(row && isId(row.user_id) ? { type: 'note', ownerId: row.user_id } : null);
        })
        // Hearts given to my things: the counts changed.
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_likes', filter: `owner_id=eq.${me}` }, (p) => {
          const r = p.new as { owner_id?: unknown; kind?: unknown; subject_key?: unknown } | null;
          const ref: SubjectRef = { ownerId: String(r?.owner_id), kind: r?.kind === 'listening' ? 'listening' : 'note', key: String(r?.subject_key) };
          emit(r && isRef(ref) && ref.ownerId === me ? { type: 'engagement', ref } : null);
        })
        .subscribe();
      return () => {
        if (!live) return;
        live = false;
        void c.removeChannel(channel);
      };
    },
  };
}

let cached: { id: string; api: ActivityApi } | null = null;
/** One API object per signed-in user. */
export function activityApiFor(userId: string): ActivityApi {
  if (!cached || cached.id !== userId) cached = { id: userId, api: createSupabaseActivityApi(userId) };
  return cached.api;
}
