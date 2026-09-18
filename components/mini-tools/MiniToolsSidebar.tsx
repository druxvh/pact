import { Calculator, NotebookPen, Timer } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { useToolsStore } from '@/store/useToolsStore';

export function MiniToolsSidebar() {
  const pomodoroMinutes = useToolsStore((state) => state.pomodoroMinutes);
  const pomodoroMode = useToolsStore((state) => state.pomodoroMode);
  const quickNote = useToolsStore((state) => state.quickNote);
  const setQuickNote = useToolsStore((state) => state.setQuickNote);

  return (
    <div className="flex flex-col gap-3">
      <Card
        title="Pomodoro"
        action={<Timer className="h-4 w-4 text-slate-400" />}
      >
        <p className="text-3xl font-semibold tabular-nums">
          {String(pomodoroMinutes).padStart(2, '0')}:00
        </p>
        <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">
          {pomodoroMode}
        </p>
      </Card>
      <Card
        title="Quick Notes"
        action={<NotebookPen className="h-4 w-4 text-slate-400" />}
      >
        <textarea
          value={quickNote}
          onChange={(event) => setQuickNote(event.target.value)}
          placeholder="Jot something down…"
          className="min-h-24 w-full resize-none rounded-lg border border-slate-800 bg-slate-950 p-2 text-sm outline-none"
        />
      </Card>
      <Card
        title="Calculator"
        action={<Calculator className="h-4 w-4 text-slate-400" />}
      >
        <p className="text-sm text-slate-400">Coming soon — local mini calc.</p>
      </Card>
    </div>
  );
}
