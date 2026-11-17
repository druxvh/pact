import { ArchiveRestore, Camera, Download, History, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, confirm, IconButton } from '@/components/ui';
import { ImportPreviewDialog } from '@/features/settings/ImportPreviewDialog';
import { createSnapshot, deleteSnapshot, listSnapshots, snapshotFile, startRestoreSnapshot } from '@/lib/backup';
import { describeCounts } from '@/lib/backup/describe';
import type { SnapshotKind, SnapshotMeta } from '@/lib/backup/types';
import { downloadText } from '@/lib/download';
import { formatBytes, relativeTime } from '@/lib/format';
import { fadeUp } from '@/lib/motion';
import { notify } from '@/lib/toast';

const KIND: Record<SnapshotKind, { label: string; tone: 'neutral' | 'brand' | 'warning' }> = {
  auto: { label: 'Daily', tone: 'neutral' },
  manual: { label: 'Manual', tone: 'brand' },
  safety: { label: 'Safety copy', tone: 'warning' },
};

function SnapshotRow({ meta, onChanged }: { meta: SnapshotMeta; onChanged: () => void }) {
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
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {new Date(meta.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          <Badge tone={kind.tone}>{kind.label}</Badge>
          {meta.kind === 'safety' && <span className="text-xs font-normal text-muted-foreground">{meta.label}</span>}
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {describeCounts(meta.counts, meta.hasWallpaper)} · {formatBytes(meta.bytes)} · {relativeTime(meta.createdAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="outline" size="sm" onClick={() => void startRestoreSnapshot(meta)}>
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

/** Settings → Data safety: the rolling local snapshots, and the dialog that previews any restore or import. */
export function DataSafetyCard() {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

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

  return (
    <motion.div variants={fadeUp} id="data-safety" className="scroll-mt-6">
      <Card className="gap-4 p-5">
        <header className="flex items-start gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-text">
            <History className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold tracking-tight">Data safety</h2>
            <p className="text-[13px] text-muted-foreground">
              pact saves a snapshot of your notes, boards, timer history, Home and preferences — including your wallpaper picture — once a day when something
              changed, and keeps the last 7 plus the ones you take. They live on this device only. Restoring (or importing a file) always shows a preview first
              and saves a safety copy.
            </p>
          </div>
          <Button variant="outline" size="sm" loading={busy} onClick={() => void snapshotNow()} className="shrink-0">
            <Camera /> Snapshot now
          </Button>
        </header>

        {failed && <p className="text-[13px] text-destructive-text">Snapshots aren’t available in this browser right now.</p>}
        {snapshots === null && !failed && <p className="text-[13px] text-muted-foreground">Loading…</p>}
        {snapshots?.length === 0 && (
          <p className="text-[13px] text-muted-foreground">
            No snapshots yet — the first one is taken automatically the next time you open pact with something worth saving.
          </p>
        )}
        {snapshots && snapshots.length > 0 && (
          <ul className="divide-y divide-border">
            {snapshots.map((m) => (
              <SnapshotRow key={m.id} meta={m} onChanged={refresh} />
            ))}
          </ul>
        )}
      </Card>
      <ImportPreviewDialog />
    </motion.div>
  );
}
