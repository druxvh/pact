import type { Visibility } from './protocol';
import type { Track } from './track';

/** One person's current track as the database holds it, with how old it is by the SERVER's clock. */
export type RemoteRow = { userId: string; track: Track; ageSeconds: number };
/** A live change: a track written (or refreshed), or a row removed. A removal may never arrive — viewers also expire rows by age. */
export type RowEvent = { type: 'upsert'; userId: string; track: Track } | { type: 'delete'; userId: string };

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Is this an account id? (The simulated demo people have ids like `alex`; only real ids ever reach the database.) */
export const isUserId = (v: string): boolean => USER_ID.test(v);

export class NowPlayingError extends Error {
  constructor(
    public code: 'unavailable' | 'not_signed_in' | 'network',
    message?: string,
  ) {
    super(message ?? code);
  }
}

/**
 * What the app needs from a backend for "Now playing". `supabaseApi` is the real thing; `memoryApi` is an in-memory stand-in for
 * tests and the dev harness. Everything it hands back has already been through `trackFromRow` (cleaned and allow-listed).
 */
export interface NowPlayingApi {
  /** The signed-in user's id. */
  readonly me: string;
  /** What these people (at most 100) are listening to right now — only the ones you may see, and only fresh rows. */
  fetch(ids: string[]): Promise<RemoteRow[]>;
  /** Live changes for these people (at most 100). Returns the unsubscribe function. */
  subscribe(ids: string[], onEvent: (e: RowEvent) => void): () => void;
  /** Who may see my track. Rejects with `unavailable` when the database doesn't have the setting yet (the migration isn't applied). */
  getVisibility(): Promise<Visibility>;
  /** Changing it to `off` also deletes my row — in the database. */
  setVisibility(v: Visibility): Promise<void>;
  /** Remove my row (sign-out, "pause sharing"). Best effort. */
  clearMine(): Promise<void>;
}
