/**
 * The hand-off between "I picked a file / pressed Restore" and "the preview dialog is showing it".
 * Nothing is applied until the person confirms in the dialog; this store only holds what was read.
 */
import { create } from 'zustand';
import { applyPlan } from '@/lib/backup/apply';
import { readLocalData, usesImageWallpaper } from '@/lib/backup/collect';
import { FILE_MAX_CHARS, parseBackupText } from '@/lib/backup/format';
import { type Plan, planImport } from '@/lib/backup/plan';
import { type PreparedBundle, prepareBundle } from '@/lib/backup/prepare';
import { loadSnapshot, snapshotBundle } from '@/lib/backup/snapshots';
import type { ImportMode, SnapshotMeta } from '@/lib/backup/types';
import { notify } from '@/lib/toast';

export type PendingImport = {
  source: { kind: 'file'; name: string; fileVersion: number } | { kind: 'snapshot'; meta: SnapshotMeta };
  prepared: PreparedBundle;
  /** What's on this device now (read when the preview opened). */
  localData: Record<string, string>;
  hereHasWallpaperImage: boolean;
};

export const useImportPreview = create<{ pending: PendingImport | null; busy: boolean }>(() => ({ pending: null, busy: false }));

export const closeImportPreview = () => useImportPreview.setState({ pending: null, busy: false });

function openPreview(source: PendingImport['source'], prepared: PreparedBundle) {
  const localData = readLocalData();
  useImportPreview.setState({ pending: { source, prepared, localData, hereHasWallpaperImage: usesImageWallpaper(localData) }, busy: false });
}

/** Read and validate a backup file, then show the preview. Errors become a toast with a plain-language reason. */
export async function startImportFromFile(file: File): Promise<void> {
  if (file.size > FILE_MAX_CHARS) {
    notify.error('Couldn’t import that file', 'It’s far too large to be a pact backup (over 48 MB).');
    return;
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    notify.error('Couldn’t read that file', 'The browser wouldn’t let pact open it.');
    return;
  }
  const parsed = parseBackupText(text);
  if (!parsed.ok) {
    notify.error('Couldn’t import that file', parsed.error);
    return;
  }
  const prepared = prepareBundle(parsed.bundle, new Date().toISOString());
  prepared.warnings.unshift(...parsed.warnings);
  if (prepared.areas.length === 0) {
    notify.error('Couldn’t import that file', prepared.warnings[0] ?? 'None of the data in it could be read.');
    return;
  }
  openPreview({ kind: 'file', name: file.name, fileVersion: parsed.fileVersion }, prepared);
}

/** Show the preview for restoring one of the automatic / manual snapshots. */
export async function startRestoreSnapshot(meta: SnapshotMeta): Promise<void> {
  const rec = await loadSnapshot(meta.id).catch(() => undefined);
  if (!rec) {
    notify.error('Couldn’t open that snapshot', 'It may have been removed.');
    return;
  }
  const prepared = prepareBundle(snapshotBundle(rec), new Date().toISOString());
  if (prepared.areas.length === 0) {
    notify.error('That snapshot is empty', 'There’s nothing in it to restore.');
    return;
  }
  openPreview({ kind: 'snapshot', meta }, prepared);
}

export function buildPlan(p: PendingImport, mode: ImportMode): Plan {
  return planImport(p.prepared, p.localData, mode, { now: new Date().toISOString(), hereHasWallpaperImage: p.hereHasWallpaperImage });
}

/** The person confirmed: apply it. */
export async function confirmImport(mode: ImportMode): Promise<void> {
  const { pending, busy } = useImportPreview.getState();
  if (!pending || busy) return;
  useImportPreview.setState({ busy: true });
  // Re-read the device: it may have changed while the dialog was open.
  const fresh: PendingImport = { ...pending, localData: readLocalData() };
  fresh.hereHasWallpaperImage = usesImageWallpaper(fresh.localData);
  const plan = buildPlan(fresh, mode);
  const label = pending.source.kind === 'snapshot' ? 'Before restoring a snapshot' : 'Before importing a backup';
  const result = await applyPlan(plan, { snapshotLabel: label, reload: () => window.setTimeout(() => window.location.reload(), 700) });
  if (!result.ok) {
    useImportPreview.setState({ busy: false });
    notify.error('Nothing was changed', result.error);
    return;
  }
  notify.success(mode === 'merge' ? 'Backup merged' : 'Backup restored', 'A copy of your previous data is in Data safety. Reloading…');
}
