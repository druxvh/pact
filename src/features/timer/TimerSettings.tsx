import { Button, confirm, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, Slider, Switch } from '@/components/ui';
import { PHASE_LABEL, PHASES, type Phase, useTimerStore } from '@/features/timer/store';
import { notify } from '@/lib/toast';
import { useSettingsStore } from '@/store/useSettingsStore';

const RANGE: Record<Phase, { min: number; max: number }> = {
  focus: { min: 1, max: 120 },
  short: { min: 1, max: 30 },
  long: { min: 5, max: 60 },
};

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function TimerSettings({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const durations = useTimerStore((s) => s.durations);
  const setDurations = useTimerStore((s) => s.setDurations);
  const autoStart = useTimerStore((s) => s.autoStart);
  const setAutoStart = useTimerStore((s) => s.setAutoStart);
  const longEvery = useTimerStore((s) => s.longEvery);
  const sessionCount = useTimerStore((s) => s.sessions.length);
  const clearHistory = useTimerStore((s) => s.clearHistory);
  const sounds = useSettingsStore((s) => s.sounds);
  const setSetting = useSettingsStore((s) => s.set);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Timer settings</DialogTitle>
          <DialogDescription>Durations apply from the next session you start.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {PHASES.map((p) => (
            <div key={p}>
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-sm font-medium">{PHASE_LABEL[p]}</p>
                <p className="tabular font-mono text-sm text-muted-foreground">{durations[p]} min</p>
              </div>
              <Slider
                aria-label={`${PHASE_LABEL[p]} minutes`}
                value={durations[p]}
                min={RANGE[p].min}
                max={RANGE[p].max}
                onValueChange={(v) => setDurations({ [p]: v })}
              />
            </div>
          ))}

          <div className="space-y-4 border-t pt-4">
            <Row label="Auto-start next session" hint="Roll straight into the next phase without waiting for you">
              <Switch checked={autoStart} onCheckedChange={setAutoStart} aria-label="Auto-start next session" />
            </Row>
            <Row label="Completion chime" hint="A soft synthesised sound when a phase ends">
              <Switch checked={sounds} onCheckedChange={(v) => setSetting('sounds', v)} aria-label="Completion chime" />
            </Row>
            <Row label="Long break" hint={`After every ${longEvery} focus sessions`}>
              <span className="text-sm text-muted-foreground">{durations.long} min</span>
            </Row>
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <p className="text-sm font-medium">History</p>
              <p className="text-xs text-muted-foreground">
                {sessionCount} recorded {sessionCount === 1 ? 'phase' : 'phases'}
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              disabled={sessionCount === 0}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Clear focus history?',
                  description: 'Your sessions, streak and charts reset to zero. This cannot be undone.',
                  confirmLabel: 'Clear history',
                  destructive: true,
                });
                if (ok) {
                  clearHistory();
                  notify.success('History cleared');
                }
              }}
            >
              Clear history
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
