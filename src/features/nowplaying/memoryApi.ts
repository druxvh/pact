/**
 * An in-memory "server" + per-user API that follows the same rules as supabase/migrations/…_now_playing.sql: a row is visible
 * for 2 minutes after its last write, to the people its owner lets see it. Used by tests and the dev harness (never shipped).
 */
import { type NowPlayingApi, NowPlayingError, type RemoteRow, type RowEvent } from './api';
import type { Visibility } from './protocol';
import type { Track } from './track';

const FRESH_MS = 120_000;

type Sub = { viewer: string; ids: Set<string>; cb: (e: RowEvent) => void };

export class MemoryNowPlayingServer {
  rows = new Map<string, { track: Track; at: number }>();
  visibility = new Map<string, Visibility>();
  subs = new Set<Sub>();
  /** Set false to see how the app behaves when the migration isn't applied. */
  available = true;
  /** Do `viewer` and `owner` share a community? (Default: everyone does.) */
  shares: (viewer: string, owner: string) => boolean = () => true;
  now = () => Date.now();

  private canSee(viewer: string, owner: string): boolean {
    if (viewer === owner) return true;
    const v = this.visibility.get(owner) ?? 'off';
    return v === 'everyone' || (v === 'communities' && this.shares(viewer, owner));
  }

  /** What `owner` is listening to — as if they had just published it. `age` (seconds) backdates it. */
  set(owner: string, track: Track, visibility: Visibility = 'everyone', ageSeconds = 0): void {
    this.visibility.set(owner, visibility);
    this.rows.set(owner, { track, at: this.now() - ageSeconds * 1000 });
    for (const s of this.subs) if (s.ids.has(owner) && this.canSee(s.viewer, owner)) s.cb({ type: 'upsert', userId: owner, track });
  }

  clear(owner: string): void {
    this.rows.delete(owner);
    for (const s of this.subs) if (s.ids.has(owner)) s.cb({ type: 'delete', userId: owner });
  }

  api(me: string): NowPlayingApi {
    const need = () => {
      if (!this.available) throw new NowPlayingError('unavailable');
    };
    return {
      me,
      fetch: async (ids) => {
        need();
        const out: RemoteRow[] = [];
        for (const id of ids.slice(0, 100)) {
          const row = this.rows.get(id);
          if (!row || !this.canSee(me, id)) continue;
          const age = Math.max(0, Math.floor((this.now() - row.at) / 1000));
          if (id !== me && age * 1000 >= FRESH_MS) continue;
          out.push({ userId: id, track: row.track, ageSeconds: age });
        }
        return out;
      },
      subscribe: (ids, cb) => {
        const sub: Sub = { viewer: me, ids: new Set(ids), cb };
        this.subs.add(sub);
        return () => this.subs.delete(sub);
      },
      getVisibility: async () => {
        need();
        return this.visibility.get(me) ?? 'off';
      },
      setVisibility: async (v) => {
        need();
        this.visibility.set(me, v);
        if (v === 'off') this.clear(me);
      },
      clearMine: async () => this.clear(me),
    };
  }
}
