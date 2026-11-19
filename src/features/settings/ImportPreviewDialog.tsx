import { TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Segmented } from '@/components/ui';
import { accountFingerprint } from '@/lib/backup/collect';
import { buildPlan, closeImportPreview, confirmImport, type PendingImport, useImportPreview } from '@/lib/backup/pending';
import { type AreaAction, planChangesAnything } from '@/lib/backup/plan';
import type { ImportMode } from '@/lib/backup/types';
import { formatBytes } from '@/lib/format';

const ACTION_BADGE: Record<AreaAction, { tone: 'brand' | 'success' | 'neutral' | 'warning'; label: string }> = {
  replace: { tone: 'brand', label: 'Replace' },
  merge: { tone: 'success', label: 'Merge' },
  keep: { tone: 'neutral', label: 'Kept as is' },
  skip: { tone: 'warning', label: 'Skipped' },
};

const when = (iso: string) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleString() : 'unknown date');

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-[13px] font-medium">{children}</dd>
    </div>
  );
}

/**
 * Shown before any import or snapshot restore. It spells out what is inside and exactly what each mode would do to
 * what's on this device; nothing is applied until the person presses the confirm button.
 */
export function ImportPreviewDialog() {
  const pending = useImportPreview((s) => s.pending);
  const busy = useImportPreview((s) => s.busy);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [here, setHere] = useState<string | null | undefined>(undefined);
  // keep the last content on screen while the dialog animates closed
  const last = useRef<PendingImport | null>(null);
  if (pending) last.current = pending;
  const shown = pending ?? last.current;

  useEffect(() => {
    if (!pending) return;
    setMode('merge');
    let live = true;
    void accountFingerprint().then((f) => live && setHere(f));
    return () => {
      live = false;
    };
  }, [pending]);

  const plan = useMemo(() => (shown ? buildPlan(shown, mode) : null), [shown, mode]);
  if (!shown || !plan) return null;

  const { prepared, source } = shown;
  const different = prepared.account !== here && (prepared.account !== null || here !== null) && here !== undefined;
  const changes = planChangesAnything(plan, shown.localData);
  const fromSnapshot = source.kind === 'snapshot';

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && !busy && closeImportPreview()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{fromSnapshot ? 'Restore this snapshot?' : 'Import this backup?'}</DialogTitle>
          <DialogDescription>
            Nothing changes until you confirm. A safety copy of your current data is saved first, so you can undo this from Data safety.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-background/50 p-3 sm:grid-cols-4">
            <Meta label={fromSnapshot ? 'Snapshot' : 'File'}>{fromSnapshot ? source.meta.label : source.name}</Meta>
            <Meta label="Made">{when(prepared.exportedAt)}</Meta>
            <Meta label="pact version">{prepared.appVersion}</Meta>
            <Meta label="Size">{fromSnapshot ? formatBytes(source.meta.bytes) : `format ${source.fileVersion}`}</Meta>
          </dl>

          {different && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-[13px] text-warning-text">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              {prepared.account
                ? 'This was made while signed in to a different account (or as a guest). Your notes will sync into the account you’re signed in to now.'
                : 'This was made as a guest. Your notes will sync into the account you’re signed in to now.'}
            </p>
          )}

          <div className="space-y-2">
            <Segmented<ImportMode>
              aria-label="What to do with the data"
              value={mode}
              onValueChange={setMode}
              options={[
                { value: 'merge', label: 'Merge with what’s here' },
                { value: 'replace', label: 'Replace what’s here' },
              ]}
            />
            <p className="text-[13px] leading-snug text-muted-foreground">
              {mode === 'merge'
                ? 'Adds what’s new, updates items where the backup’s copy is newer, and keeps everything else. Preferences stay as they are.'
                : 'Makes this device match the backup for everything inside it. Things here that aren’t in it are removed, and older copies can overwrite newer edits.'}
            </p>
          </div>

          <ul className="divide-y divide-border rounded-lg border">
            {plan.areas.map((a) => {
              const badge = ACTION_BADGE[a.action];
              return (
                <li key={a.id} className="space-y-1 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-medium">{a.label}</span>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    In the backup: <span className="text-foreground">{a.contents}</span>
                    {a.here !== a.contents && (
                      <>
                        {' '}
                        · On this device: <span className="text-foreground">{a.here}</span>
                      </>
                    )}
                  </p>
                  {a.lines.map((line) => (
                    <p key={line} className="text-xs text-muted-foreground">
                      {line}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>

          {plan.wallpaper.action === 'set' && (
            <p className="text-xs text-muted-foreground">Your wallpaper picture ({formatBytes(plan.wallpaper.media.blob.size)}) is restored too.</p>
          )}

          {plan.warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-warning/40 bg-warning-soft p-3 text-xs text-warning-text">
              {plan.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={closeImportPreview}>
            Cancel
          </Button>
          <Button variant={mode === 'replace' ? 'destructive' : 'primary'} loading={busy} disabled={!changes} onClick={() => void confirmImport(mode)}>
            {!changes ? 'Nothing would change' : mode === 'replace' ? 'Replace my data' : 'Merge into my data'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
