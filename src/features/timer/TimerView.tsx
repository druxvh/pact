import { useEffect, useMemo } from 'react';
import { Play, Pause, RotateCcw, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToolsStore } from '@/features/timer/store';
import { useNotificationStore } from '@/store/useNotificationStore';

export function TimerView() {
  const mode = useToolsStore((s) => s.pomodoroMode);
  const setMode = useToolsStore((s) => s.setPomodoroMode);
  const setMinutes = useToolsStore((s) => s.setPomodoroMinutes);
  const pomodoroMinutes = useToolsStore((s) => s.pomodoroMinutes);
  const secondsLeft = useToolsStore((s) => s.secondsLeft);
  const isRunning = useToolsStore((s) => s.isRunning);
  const start = useToolsStore((s) => s.start);
  const pause = useToolsStore((s) => s.pause);
  const reset = useToolsStore((s) => s.reset);
  const tick = useToolsStore((s) => s.tick);
  const notify = useNotificationStore((s) => s.add);

  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => tick(), 1000);
    return () => clearInterval(id);
  }, [isRunning, tick]);

  // notify on completion
  useEffect(() => {
    if (secondsLeft === 0 && !isRunning) {
      // only notify if we just finished (avoid initial 0)
      const t = setTimeout(() => {
        notify({ title: 'Timer done', body: `${mode} session finished`, kind: 'system' });
        try { new Audio('').play().catch(() => {}); } catch {}
      }, 0);
      return () => clearTimeout(t);
    }
  }, [secondsLeft, isRunning, mode, notify]);

  const fmt = useMemo(() => {
    const m = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
    const s = String(secondsLeft % 60).padStart(2, '0');
    return `${m}:${s}`;
  }, [secondsLeft]);

  const progress = useMemo(() => {
    const total = pomodoroMinutes * 60 || 1;
    return Math.max(0, Math.min(1, 1 - secondsLeft / total));
  }, [secondsLeft, pomodoroMinutes]);

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24 }} className="mx-auto max-w-3xl space-y-4">
      <div className="text-center">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Timer</h2>
        <p className="text-xs text-muted-foreground">Focus · Break</p>
      </div>

      <Card className="p-8">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1.5 rounded-sm border border-border bg-muted p-1 text-xs">
            {(['idle', 'focus', 'break'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-sm px-3 py-1 capitalize transition-colors duration-150 ${mode === m ? 'bg-accent text-accent-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="relative mt-8">
            <motion.div key={fmt} initial={{ scale: 0.98, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.16 }} className="font-mono text-7xl font-light tracking-tighter text-foreground tabular-nums">
              {fmt}
            </motion.div>
            <div className="absolute -bottom-2 left-1/2 h-1 w-32 -translate-x-1/2 overflow-hidden rounded-full bg-muted">
              <motion.div className="h-full bg-accent" animate={{ width: `${progress * 100}%` }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }} />
            </div>
          </div>

          <p className="mt-6 text-xs uppercase tracking-widest text-muted-foreground">{mode} · {isRunning ? 'running' : secondsLeft === 0 ? 'done!' : 'paused'}</p>

          <div className="mt-8 flex items-center gap-3">
            <AnimatePresence mode="wait" initial={false}>
              {!isRunning ? (
                <motion.div key="play" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                  <Button size="icon" className="h-12 w-12 rounded-full bg-accent text-accent-foreground hover:bg-accent/90" onClick={start} disabled={secondsLeft === 0}>
                    <Play className="h-5 w-5 ml-0.5" />
                  </Button>
                </motion.div>
              ) : (
                <motion.div key="pause" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                  <Button variant="secondary" size="icon" className="h-12 w-12 rounded-full" onClick={pause}>
                    <Pause className="h-5 w-5" />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
              <Button variant="ghost" size="icon" className="h-12 w-12 rounded-sm border border-border" onClick={reset}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </motion.div>
          </div>

          <div className="mt-6 flex gap-1.5">
            {[15, 25, 45].map((m) => (
              <button key={m} onClick={() => setMinutes(m)} className="rounded-sm border border-border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
                {m}m
              </button>
            ))}
          </div>

          <AnimatePresence>
            {secondsLeft === 0 && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 rounded-sm border border-border bg-muted px-4 py-2 text-sm text-foreground">
                🎉 Time’s up — take a break!
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Card>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 }} className="grid gap-3 md:grid-cols-3">
        <Card>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Today</p>
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">2</p>
          <p className="text-xs text-muted-foreground">sessions · 50 min</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-foreground">Streak</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">3 days</p>
          <p className="text-xs text-muted-foreground">keep going</p>
        </Card>
        <Card>
          <p className="text-sm font-medium text-foreground">Quick note</p>
          <QuickNote />
        </Card>
      </motion.div>
    </motion.div>
  );
}

function QuickNote() {
  const note = useToolsStore((s) => s.quickNote);
  const setNote = useToolsStore((s) => s.setQuickNote);
  return (
    <textarea
      value={note}
      onChange={(e) => setNote(e.target.value)}
      placeholder="Jot while you focus…"
      rows={2}
      className="mt-2 min-h-[56px] w-full resize-none rounded-sm border border-input bg-background p-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
    />
  );
}
