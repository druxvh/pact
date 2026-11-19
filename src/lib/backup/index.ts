import { collectBundle } from '@/lib/backup/collect';
import { backupFileName, serializeBundle } from '@/lib/backup/format';
import { downloadText } from '@/lib/download';
import { notify } from '@/lib/toast';

export { closeImportPreview, confirmImport, startImportFromFile, startRestoreSnapshot, useImportPreview } from '@/lib/backup/pending';
export { createSnapshot, deleteSnapshot, listSnapshots, snapshotFile, startAutoSnapshots } from '@/lib/backup/snapshots';

/** Download everything as one file (wallpaper picture included, shrunk if it's huge). */
export async function exportBackupFile(): Promise<void> {
  try {
    const { bundle, wallpaperSkipped } = await collectBundle();
    downloadText(backupFileName(bundle.exportedAt), await serializeBundle(bundle));
    notify.success(
      'Backup downloaded',
      wallpaperSkipped
        ? 'Your wallpaper picture was too large to include. Chat attachments (images and video) aren’t included either.'
        : 'Chat attachments (images and video) aren’t included.',
    );
  } catch {
    notify.error('Couldn’t create the backup', 'Something went wrong reading your data.');
  }
}
