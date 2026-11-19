/**
 * Doing what the plan says — carefully.
 *
 * Order matters and every step has a failure story:
 *   1. a safety snapshot of what's here now (if that fails, nothing is changed);
 *   2. the wallpaper picture (IndexedDB can fail; nothing has been touched yet if it does);
 *   3. stop notes sync and freeze every store's persistence, so no in-memory (old) state can be written over what we
 *      are about to write;
 *   4. write each store's data, remembering the old values so a failure part-way (storage full) rolls all of it back;
 *   5. tell notes sync what changed, so it uploads the restored notes instead of overwriting or ignoring them;
 *   6. reload, so every store and the theme start from exactly what was written.
 */

import { recordLocalReplacement } from '@/features/notes/sync/bookkeeping';
import { haltNotesSync } from '@/features/notes/sync/engine';
import type { Local } from '@/features/notes/sync/model';
import { BOOT_KEY } from '@/lib/appearance/apply';
import { IMAGE_ASSET_ID } from '@/lib/appearance/wallpaper';
import { deleteAsset, putAsset } from '@/lib/assets';
import type { Plan } from '@/lib/backup/plan';
import { createSnapshot } from '@/lib/backup/snapshots';
import { freezePersistence } from '@/lib/persist';
import { useAuthStore } from '@/store/useAuthStore';

export type ApplyResult = { ok: true } | { ok: false; error: string };

export async function applyPlan(plan: Plan, opts: { snapshotLabel: string; reload?: () => void }): Promise<ApplyResult> {
  try {
    await createSnapshot({ kind: 'safety', label: opts.snapshotLabel });
  } catch {
    return { ok: false, error: 'Couldn’t save a safety copy of your current data first, so nothing was changed.' };
  }

  try {
    if (plan.wallpaper.action === 'set') await putAsset(IMAGE_ASSET_ID, plan.wallpaper.media.blob);
    else if (plan.wallpaper.action === 'remove') await deleteAsset(IMAGE_ASSET_ID);
  } catch {
    return { ok: false, error: 'Couldn’t store the wallpaper picture, so nothing was changed.' };
  }

  haltNotesSync();
  freezePersistence();

  const previous = new Map<string, string | null>();
  try {
    for (const [key, json] of Object.entries(plan.writes)) {
      previous.set(key, localStorage.getItem(key));
      localStorage.setItem(key, json);
    }
  } catch {
    for (const [key, old] of previous) {
      try {
        if (old === null) localStorage.removeItem(key);
        else localStorage.setItem(key, old);
      } catch {
        /* nothing more can be done */
      }
    }
    opts.reload?.();
    return { ok: false, error: 'There wasn’t enough room in this browser’s storage, so nothing was changed.' };
  }

  if (plan.notes && useAuthStore.getState().status === 'signedIn') {
    recordLocalReplacement(
      plan.notes.prev as unknown as Local,
      plan.notes.next as unknown as Local,
      new Date().toISOString(),
      useAuthStore.getState().user?.id ?? null,
    );
  }
  try {
    localStorage.removeItem(BOOT_KEY); // the cached first-paint appearance is rebuilt from the restored data
  } catch {
    /* ignore */
  }
  opts.reload?.();
  return { ok: true };
}
