import { Cloud, CloudAlert, CloudOff, RefreshCw } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { type SyncStatus, useNotesSync } from '@/features/notes/sync/engine';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { useAuthStore } from '@/store/useAuthStore';

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
  const localOnly = useNotesSync((s) => s.localOnly);
  const offlineSession = useAuthStore((s) => s.offline);
  const { icon, label } = COPY[status];
  let detail = pending > 0 && status !== 'syncing' ? `${label} (${pending} waiting)` : status === 'synced' && last ? `${label} · ${relativeTime(last)}` : label;
  if (offlineSession) detail = 'Offline — opened from your saved sign-in. Everything on this device works; it will reconnect by itself.';

  // Items the server can't take stay on this device (and don't block everything else) — say which, and why.
  const warn = localOnly.length > 0;
  if (warn) {
    const names = localOnly
      .slice(0, 3)
      .map((i) => `“${i.title.length > 40 ? `${i.title.slice(0, 40)}…` : i.title}”`)
      .join(', ');
    const more = localOnly.length > 3 ? ` and ${localOnly.length - 3} more` : '';
    detail = `${detail}. ${localOnly.length === 1 ? '1 item stays' : `${localOnly.length} items stay`} on this device only and can’t sync: ${names}${more}. ${localOnly[0]?.message ?? ''}`;
  }

  const Icon = offlineSession ? CloudOff : warn && (status === 'idle' || status === 'synced') ? CloudAlert : icon;
  return (
    <Tooltip content={<span className="max-w-72 whitespace-normal">{detail}</span>}>
      <span
        role="status"
        aria-label={detail}
        className={cn(
          'grid size-8 place-items-center text-muted-foreground',
          (status === 'offline' || status === 'error' || warn || offlineSession) && 'text-warning-text',
        )}
      >
        <Icon className={cn('size-4', status === 'syncing' && 'animate-spin')} />
      </span>
    </Tooltip>
  );
}
