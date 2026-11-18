import { ArchiveRestore, Camera, ChevronRight, Download, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, confirm, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, IconButton } from '@/components/ui';
import { ImportPreviewDialog } from '@/features/settings/ImportPreviewDialog';
import { createSnapshot, deleteSnapshot, listSnapshots, snapshotFile, startRestoreSnapshot } from '@/lib/backup';
import { describeCounts } from '@/lib/backup/describe';
import type { SnapshotKind, SnapshotMeta } from '@/lib/backup/types';
import { downloadText } from '@/lib/download';
import { formatBytes, relativeTime } from '@/lib/format';
import { notify } from '@/lib/toast';
import { SettingsRow } from './ui';

const KIND: Record<SnapshotKind, { label: string; tone: 'neutral' | 'brand' | 'warning' }> = {
  auto: { label: 'Daily', tone: 'neutral' },
  manual: { label: 'Manual', tone: 'brand' },
  safety: { label: 'Safety copy', tone: 'warning' },
};

/** How many snapshots are shown in the row itself; the rest are behind "See all". */
export const INLINE_SNAPSHOTS = 3;

function SnapshotItem({ meta, onChanged, onRestore }: { meta: SnapshotMeta; onChanged: () => void; onRestore?: () => void }) {
  const kind = KIND[meta.kind];
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const file = await snapshotFile(meta.id);
      if (!file) notify.error('Couldn’t find that snapshot');
      else downloadText(file.name, file.text);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this snapshot?',
      description: 'It can’t be recovered. Your current data isn’t affected.',
      confirmLabel: 'Delete snapshot',
      destructive: true,
    });
    if (!ok) return;
    await deleteSnapshot(meta.id).catch(() => notify.error('Couldn’t delete the snapshot'));
    onChanged();
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2">
      <div className="min-w-0 flex-1 basis-48">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium">
          {new Date(meta.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          <Badge tone={kind.tone}>{kind.label}</Badge>
        </p>
        <p className="line-clamp-2 text-xs text-muted-foreground" title={meta.kind === 'safety' ? meta.label : undefined}>
          {meta.kind === 'safety' && meta.label ? `${meta.label} · ` : ''}
          {describeCounts(meta.counts, meta.hasWallpaper)} · {formatBytes(meta.bytes)} · {relativeTime(meta.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onRestore?.();
            void startRestoreSnapshot(meta);
          }}
        >
          <ArchiveRestore /> Restore
        </Button>
        <IconButton label="Download this snapshot" size="icon-sm" disabled={busy} onClick={() => void download()}>
          <Download />
        </IconButton>
        <IconButton label="Delete this snapshot" size="icon-sm" onClick={() => void remove()}>
          <Trash2 />
        </IconButton>
      </div>
    </li>
  );
}

/**
 * Settings → Your data → Snapshots: the newest few in place, the rest behind "See all". Also hosts the dialog that previews
 * any restore or import (it is shared with Import in the Backup row), so it must stay mounted while Settings is open.
 */
export function SnapshotRows() {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);

  const refresh = useCallback(() => {
    listSnapshots()
      .then((s) => {
        setSnapshots(s);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(refresh, [refresh]);

  const snapshotNow = async () => {
    setBusy(true);
    try {
      const made = await createSnapshot({ kind: 'manual' });
      if (made) notify.success('Snapshot saved', describeCounts(made.counts, made.hasWallpaper));
      else notify.info('Nothing has changed', 'Your newest snapshot already holds everything that’s here now.');
      refresh();
    } catch {
      notify.error('Couldn’t save a snapshot', 'This browser wouldn’t let pact store it.');
    } finally {
      setBusy(false);
    }
  };

  const total = snapshots?.length ?? 0;
  const newest = snapshots?.[0];
  const summary = failed
    ? 'Snapshots aren’t available in this browser right now.'
    : snapshots === null
      ? 'Loading…'
      : newest
        ? `${total} saved, latest ${relativeTime(newest.createdAt)} · daily (last 7) plus yours, on this device.`
        : 'None yet — the first is taken automatically once there is something to save.';

  return (
    <>
      <SettingsRow label="Snapshots" description={summary}>
        <Button variant="outline" size="sm" loading={busy} onClick={() => void snapshotNow()}>
          <Camera /> Snapshot now
        </Button>
        {total > INLINE_SNAPSHOTS && (
          <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
            See all {total}
            <ChevronRight />
          </Button>
        )}
      </SettingsRow>

      {snapshots && snapshots.length > 0 && (
        <ul className="divide-y divide-border/60 pl-3">
          {snapshots.slice(0, INLINE_SNAPSHOTS).map((m) => (
            <SnapshotItem key={m.id} meta={m} onChanged={refresh} />
          ))}
        </ul>
      )}

      <Dialog open={all} onOpenChange={setAll}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>All snapshots</DialogTitle>
            <DialogDescription>
              Restoring (or importing a file) always shows a preview first and saves a safety copy. Daily snapshots keep the last 7; the others stay until you
              delete them.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="max-h-[min(30rem,calc(100dvh-10rem))] overflow-y-auto py-2">
            <ul className="divide-y divide-border/70">
              {(snapshots ?? []).map((m) => (
                <SnapshotItem key={m.id} meta={m} onChanged={refresh} onRestore={() => setAll(false)} />
              ))}
            </ul>
          </DialogBody>
        </DialogContent>
      </Dialog>
      <ImportPreviewDialog />
    </>
  );
}
