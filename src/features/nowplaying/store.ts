/**
 * What the people on screen are listening to. Lazy by design: a component that shows someone's avatar or card calls
 * `useListening(userId)`, which registers interest (`watch`); only the ids currently watched are fetched and subscribed to —
 * never "everyone". The store keeps one row per person with its own expiry, and:
 *
 *   • a row older than 2 minutes counts as "not listening" here too (the database already hides it; we don't rely on a delete
 *     arriving, because Realtime can't deliver one to a filtered subscription) — measured as time since we RECEIVED it, so a
 *     wrong system clock can't make a stale track look fresh (the server tells us each row's age);
 *   • live changes arrive over Realtime; a slow poll (while the page is visible) and a refresh when you come back to the
 *     page cover whatever Realtime missed;
 *   • demo people (ids that aren't account ids) are served from `demo.ts`, never from the network.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { isUserId, type NowPlayingApi, type RemoteRow, type RowEvent } from './api';
import { DEMO_LISTENING } from './demo';
import type { Track } from './track';

/** A row counts for this long after we received it (the database's freshness window). */
export const TTL_MS = 120_000;
const SWEEP_MS = 10_000;
const POLL_MS = 45_000;
const SETTLE_MS = 250;
const REFRESH_GAP_MS = 5000;
/** Realtime's filter takes at most 100 values, and so does the database function. */
export const MAX_WATCHED = 100;

export type Row = { track: Track; expiresAt: number };

export type NowPlayingState = {
  rows: Record<string, Row>;
  /** Start caring about someone (a mounted avatar or card). Returns the function that stops. */
  watch(userId: string): () => void;
  /** Sign-in, sign-out or account switch: forget what we knew about real people and start over for whoever is still on screen. */
  reset(): void;
};

export type NowPlayingStore = UseBoundStore<StoreApi<NowPlayingState>>;

export function createNowPlayingStore(
  getApi: () => NowPlayingApi | null,
  deps: { now?: () => number; demo?: Readonly<Record<string, Track>>; visible?: () => boolean } = {},
): NowPlayingStore {
  const now = deps.now ?? Date.now;
  const demo = deps.demo ?? DEMO_LISTENING;
  const visible = deps.visible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible');

  return create<NowPlayingState>((set, get) => {
    const watchers = new Map<string, number>();
    let unsubscribe: (() => void) | null = null;
    let subscribedKey = '';
    let settle: ReturnType<typeof setTimeout> | undefined;
    let sweep: ReturnType<typeof setInterval> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let lastRefresh = 0;
    let removeListeners: (() => void) | null = null;
    /** Bumped by `reset`, so an answer that arrives after it is thrown away. */
    let epoch = 0;
    let unavailableUntil = 0;

    const ids = (): string[] => [...watchers.keys()].filter(isUserId).slice(0, MAX_WATCHED);

    const putRows = (rows: Record<string, Row | null>) =>
      set((s) => {
        const next = { ...s.rows };
        for (const [id, row] of Object.entries(rows)) {
          if (row) next[id] = row;
          else delete next[id];
        }
        return { rows: next };
      });

    const apply = (e: RowEvent) => {
      if (!watchers.has(e.userId)) return;
      putRows({ [e.userId]: e.type === 'upsert' ? { track: e.track, expiresAt: now() + TTL_MS } : null });
    };

    /** Fetch these people and replace what we know about them (anyone not returned stopped listening, or isn't visible to us). */
    const refresh = async (wanted: string[]) => {
      const api = getApi();
      if (!api || wanted.length === 0 || now() < unavailableUntil) return;
      lastRefresh = now();
      const mine = epoch;
      let found: RemoteRow[];
      try {
        found = await api.fetch(wanted);
      } catch (err) {
        // The database doesn't have the feature yet: say nothing, and don't ask again for a while. A dropped connection: try again at the next poll.
        if ((err as { code?: string }).code === 'unavailable') unavailableUntil = now() + 10 * 60_000;
        return;
      }
      if (mine !== epoch) return;
      const received = now();
      const next: Record<string, Row | null> = {};
      const byId = new Map(found.map((r) => [r.userId, r]));
      for (const id of wanted) {
        if (!watchers.has(id)) continue;
        const row = byId.get(id);
        next[id] = row ? { track: row.track, expiresAt: received + Math.max(0, TTL_MS - row.ageSeconds * 1000) } : null;
      }
      putRows(next);
    };

    const stop = () => {
      clearTimeout(settle);
      clearInterval(sweep);
      clearInterval(poll);
      sweep = poll = undefined;
      unsubscribe?.();
      unsubscribe = null;
      subscribedKey = '';
      removeListeners?.();
      removeListeners = null;
    };

    const sync = () => {
      const wanted = ids();
      if (wanted.length === 0) {
        stop();
        return;
      }
      const api = getApi();
      if (!api) return;
      const key = [...wanted].sort().join(',');
      if (key !== subscribedKey) {
        const previous = new Set(subscribedKey.split(',').filter(Boolean));
        unsubscribe?.();
        unsubscribe = api.subscribe(wanted, apply);
        subscribedKey = key;
        const added = wanted.filter((id) => !previous.has(id));
        if (added.length > 0) void refresh(added);
      }
      sweep ??= setInterval(() => {
        const t = now();
        const expired = Object.entries(get().rows).filter(([id, r]) => isUserId(id) && r.expiresAt <= t);
        if (expired.length > 0) putRows(Object.fromEntries(expired.map(([id]) => [id, null])));
      }, SWEEP_MS);
      poll ??= setInterval(() => {
        if (visible()) void refresh(ids());
      }, POLL_MS);
      if (!removeListeners && typeof document !== 'undefined') {
        // Coming back to the page: catch up on whatever Realtime missed while it was in the background.
        const back = () => {
          if (visible() && now() - lastRefresh >= REFRESH_GAP_MS) void refresh(ids());
        };
        document.addEventListener('visibilitychange', back);
        window.addEventListener('focus', back);
        removeListeners = () => {
          document.removeEventListener('visibilitychange', back);
          window.removeEventListener('focus', back);
        };
      }
    };

    const schedule = () => {
      clearTimeout(settle);
      settle = setTimeout(sync, SETTLE_MS);
    };

    return {
      rows: {},

      watch(userId) {
        const demoTrack = demo[userId];
        if (demoTrack) {
          // a simulated person: always "listening", nothing to fetch
          if (!get().rows[userId]) putRows({ [userId]: { track: demoTrack, expiresAt: Number.POSITIVE_INFINITY } });
          return () => {};
        }
        if (!isUserId(userId)) return () => {};
        watchers.set(userId, (watchers.get(userId) ?? 0) + 1);
        schedule();
        let released = false;
        return () => {
          if (released) return;
          released = true;
          const n = (watchers.get(userId) ?? 1) - 1;
          if (n <= 0) watchers.delete(userId);
          else watchers.set(userId, n);
          schedule();
        };
      },

      reset() {
        epoch++; // answers still on their way belong to the old account
        stop();
        unavailableUntil = 0;
        set((s) => ({ rows: Object.fromEntries(Object.entries(s.rows).filter(([id]) => !isUserId(id))) }));
        if (watchers.size > 0) schedule(); // the people on screen are looked up again (with the new account's API)
      },
    };
  });
}
