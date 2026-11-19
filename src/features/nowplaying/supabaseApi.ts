/**
 * The real data layer for "Now playing": the `now_playing` table and the `now_playing_for` function (all the rules are in the
 * database — supabase/migrations/20261119100000_now_playing.sql; this file only shapes requests), plus Realtime for live updates.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { isUserId, type NowPlayingApi, NowPlayingError, type RemoteRow, type RowEvent } from './api';
import { isVisibility, type Visibility } from './protocol';
import { trackFromRow } from './track';

function client(): SupabaseClient {
  if (!supabase) throw new NowPlayingError('unavailable', 'Accounts aren’t set up in this build.');
  return supabase;
}

type DbError = { code?: string; message?: string } | null;
/** The migration isn't applied to this project yet (no such table / function / column). */
const isMissing = (e: DbError) =>
  !!e &&
  (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(e.code ?? '') ||
    /does not exist|schema cache|could not find/i.test(e.message ?? ''));
const isNetwork = (e: DbError) => /failed to fetch|network|load failed/i.test(e?.message ?? '');

let channelSeq = 0;

export function createSupabaseNowPlayingApi(me: string): NowPlayingApi {
  return {
    me,
    async fetch(rawIds) {
      const ids = rawIds.filter(isUserId).slice(0, 100);
      if (ids.length === 0) return [];
      const { data, error } = await client().rpc('now_playing_for', { p_ids: ids });
      if (error) {
        if (isMissing(error)) throw new NowPlayingError('unavailable');
        throw new NowPlayingError(isNetwork(error) ? 'network' : 'unavailable', error.message);
      }
      const rows: RemoteRow[] = [];
      for (const r of Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []) {
        const track = trackFromRow(r);
        if (track && typeof r.user_id === 'string') rows.push({ userId: r.user_id, track, ageSeconds: typeof r.age_seconds === 'number' ? r.age_seconds : 0 });
      }
      return rows;
    },

    subscribe(rawIds, onEvent) {
      const ids = rawIds.filter(isUserId).slice(0, 100); // only UUIDs go into the filter string
      if (ids.length === 0) return () => {};
      const c = client();
      // The filter keeps this to the people on screen (Realtime allows up to 100 values); RLS still decides what each viewer is sent.
      const channel = c
        .channel(`now-playing:${++channelSeq}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'now_playing', filter: `user_id=in.(${ids.join(',')})` }, (p) => {
          const e: RowEvent | null = (() => {
            if (p.eventType === 'DELETE') {
              const id = (p.old as { user_id?: unknown } | null)?.user_id;
              return typeof id === 'string' ? { type: 'delete', userId: id } : null;
            }
            const row = p.new as Record<string, unknown>;
            const track = trackFromRow(row);
            return track && typeof row.user_id === 'string' ? { type: 'upsert', userId: row.user_id, track } : null;
          })();
          if (e) onEvent(e);
        })
        .subscribe();
      return () => void c.removeChannel(channel);
    },

    async getVisibility() {
      const { data, error } = await client().from('profiles').select('now_playing_visibility').eq('id', me).maybeSingle();
      if (error) throw new NowPlayingError(isMissing(error) ? 'unavailable' : isNetwork(error) ? 'network' : 'unavailable', error.message);
      const v = (data as { now_playing_visibility?: unknown } | null)?.now_playing_visibility;
      return isVisibility(v) ? v : 'off';
    },

    async setVisibility(v: Visibility) {
      const { error } = await client().from('profiles').update({ now_playing_visibility: v }).eq('id', me);
      if (error) throw new NowPlayingError(isMissing(error) ? 'unavailable' : isNetwork(error) ? 'network' : 'unavailable', error.message);
    },

    async clearMine() {
      await client().from('now_playing').delete().eq('user_id', me);
    },
  };
}

let cached: { id: string; api: NowPlayingApi } | null = null;
/** One API object per signed-in user. */
export function nowPlayingApiFor(userId: string): NowPlayingApi {
  if (!cached || cached.id !== userId) cached = { id: userId, api: createSupabaseNowPlayingApi(userId) };
  return cached.api;
}
