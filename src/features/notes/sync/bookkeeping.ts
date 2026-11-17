/**
 * Telling notes sync about a change it didn't see happen.
 *
 * Restoring a backup rewrites the notes store directly in localStorage and reloads. Without this, the engine would
 * start from stale bookkeeping: restored notes it has "already seen" would look unchanged (so they'd never upload) and
 * notes the restore removed would come straight back from the server. Here the difference between what was on the
 * device and what the restore wrote is recorded as ordinary local edits and deletions, so the next sync uploads them —
 * and a note that also changed on the server in the meantime becomes a conflict copy, not a silent overwrite.
 */
import { emptySyncState, type Local, normalizeSyncState, SYNC_STATE_KEY, trackChanges } from '@/features/notes/sync/model';

export function recordLocalReplacement(prev: Local, next: Local, now: string, owner: string | null): void {
  let saved = null;
  try {
    const raw = localStorage.getItem(SYNC_STATE_KEY);
    saved = raw ? normalizeSyncState(JSON.parse(raw)) : null;
  } catch {
    /* unreadable bookkeeping is treated as none */
  }
  const base = saved && saved.owner === owner ? saved : emptySyncState(owner);
  try {
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(trackChanges(base, prev, next, now)));
  } catch {
    /* storage full — a full pull will mark whatever the server lacks as new */
  }
}
