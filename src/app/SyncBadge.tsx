import { Cloud, CloudAlert, CloudOff, RefreshCw } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { type SyncStatus, useNotesSync } from '@/features/notes/sync/engine';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';

const COPY: Record<SyncStatus, { icon: typeof Cloud; label: string }> = {
  idle: { icon: Cloud, label: 'Signed in' },
  syncing: { icon: RefreshCw, label: 'Saving to your account…' },
  synced: { icon: Cloud, label: 'Saved to your account' },
  offline: { icon: CloudOff, label: 'Offline — changes are kept on this device and will upload when you’re back' },
  error: { icon: CloudAlert, label: 'Couldn’t reach your account — retrying' },
};

/** A quiet indicator of whether your notes are safely in your account. */
export function SyncBadge() {
  const status = useNotesSync((s) => s.status);
  const pending = useNotesSync((s) => s.pending);
  const last = useNotesSync((s) => s.lastSyncedAt);
  const { icon: Icon, label } = COPY[status];
  const detail =
    pending > 0 && status !== 'syncing' ? `${label} (${pending} waiting)` : status === 'synced' && last ? `${label} · ${relativeTime(last)}` : label;
  return (
    <Tooltip content={detail}>
      <span
        role="status"
        aria-label={detail}
        className={cn('grid size-8 place-items-center text-muted-foreground', (status === 'offline' || status === 'error') && 'text-warning-text')}
      >
        <Icon className={cn('size-4', status === 'syncing' && 'animate-spin')} />
      </span>
    </Tooltip>
  );
}
