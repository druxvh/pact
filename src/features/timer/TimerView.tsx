import { CheckCircle2, Flame, Pause, Play, RotateCcw, Settings2, SkipForward, Timer, Trophy } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Badge, Card, EmptyState, IconButton, InputGroup, PageHeader, Segmented, Select } from '@/components/ui';
import { useKanbanStore } from '@/features/kanban/store';
import { AnimatedDigits } from '@/features/timer/AnimatedDigits';
import { lastDays, streak, todayStats, totalFocusMinutes } from '@/features/timer/stats';
import { PHASE_LABEL, PHASES, type Phase, useTimerStore } from '@/features/timer/store';
import { TimerRing } from '@/features/timer/TimerRing';
import { TimerSettings } from '@/features/timer/TimerSettings';
import { useCountdown } from '@/features/timer/useCountdown';
import { cn } from '@/lib/cn';
import { formatClock, formatMinutes, pluralize, relativeTime } from '@/lib/format';
import { useHotkeys } from '@/lib/hotkeys';
import { spring } from '@/lib/motion';

const NO_TASK = '__none__';

/** Particles that fly out of the ring when a session completes. */
function Burst({ id }: { id: string }) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new burst per completion id
  const particles = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => {
        const angle = (i / 18) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 110 + Math.random() * 70;
        return {
          i,
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist,
          size: 5 + Math.random() * 6,
          color: ['var(--brand)', 'oklch(0.82 0.17 78)', 'var(--success)', 'oklch(0.98 0 0)'][i % 4] ?? 'var(--brand)',
        };
      }),
    [id],
  );
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
      {particles.map((p) => (
        <motion.span
          key={p.i}
          initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
          animate={{ x: p.x, y: p.y, scale: [0, 1.2, 0.6], opacity: [1, 1, 0] }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          className="absolute rounded-full"
          style={{ width: p.size, height: p.size, background: p.color }}
        />
      ))}
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: typeof Flame; label: string; value: string; sub: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-text">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold leading-tight tracking-tight tabular">{value}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}

export function TimerView() {
  const { status, phase, seconds, progress } = useCountdown();
  const start = useTimerStore((s) => s.start);
  const pause = useTimerStore((s) => s.pause);
  const reset = useTimerStore((s) => s.reset);
  const skip = useTimerStore((s) => s.skip);
  const setPhase = useTimerStore((s) => s.setPhase);
  const cycle = useTimerStore((s) => s.cycle);
  const longEvery = useTimerStore((s) => s.longEvery);
  const intent = useTimerStore((s) => s.intent);
  const setIntent = useTimerStore((s) => s.setIntent);
  const linkedTaskId = useTimerStore((s) => s.linkedTaskId);
  const setLinkedTask = useTimerStore((s) => s.setLinkedTask);
  const sessions = useTimerStore((s) => s.sessions);
  const lastCompleted = useTimerStore((s) => s.lastCompleted);
  const tasks = useKanbanStore((s) => s.tasks);
  const boards = useKanbanStore((s) => s.boards);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const running = status === 'running';
  const isBreak = phase !== 'focus';
  const toggle = () => (running ? pause() : start());

  useHotkeys([
    { keys: 'space', ignoreInteractive: true, enabled: !settingsOpen, handler: toggle },
    { keys: 'r', ignoreInteractive: true, enabled: !settingsOpen, handler: reset },
  ]);

  const today = useMemo(() => todayStats(sessions), [sessions]);
  const week = useMemo(() => lastDays(sessions, 7), [sessions]);
  const streakDays = useMemo(() => streak(sessions), [sessions]);
  const totalMin = useMemo(() => totalFocusMinutes(sessions), [sessions]);
  const recent = useMemo(() => sessions.filter((s) => s.phase === 'focus').slice(0, 6), [sessions]);
  const maxMin = Math.max(60, ...week.map((d) => d.minutes));

  const openTasks = tasks.filter((t) => t.columnId !== 'done');
  const linked = openTasks.find((t) => t.id === linkedTaskId);
  const taskOptions = [
    { value: NO_TASK, label: 'No linked task' },
    ...openTasks.map((t) => ({
      value: t.id,
      label: `#${t.number} ${t.title}${boards.length > 1 ? ` · ${boards.find((b) => b.id === t.boardId)?.name ?? ''}` : ''}`,
    })),
  ];

  const burstFresh = lastCompleted !== null && Date.now() - lastCompleted.at < 4000;
  const nextPhase: Phase = phase === 'focus' ? (cycle + 1 >= longEvery ? 'long' : 'short') : 'focus';
  const primaryLabel = running ? 'Pause' : status === 'paused' ? 'Resume' : `Start ${PHASE_LABEL[phase].toLowerCase()}`;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Timer}
        title="Focus"
        description={
          today.sessions ? `${pluralize(today.sessions, 'session')} · ${formatMinutes(today.minutes)} focused today` : 'Deep-work timer — one thing at a time'
        }
        actions={
          <IconButton label="Timer settings" variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings2 />
          </IconButton>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── Timer ── */}
        <Card className="items-center gap-7 px-4 py-8 sm:px-8">
          <Segmented<Phase>
            aria-label="Timer phase"
            value={phase}
            disabled={running}
            onValueChange={setPhase}
            options={PHASES.map((p) => ({ value: p, label: PHASE_LABEL[p] }))}
          />

          <div className="relative">
            <TimerRing progress={progress} running={running} tone={isBreak ? 'success' : 'brand'}>
              <div className="flex flex-col items-center gap-3">
                <AnimatedDigits value={formatClock(seconds)} running={running} className="text-[clamp(56px,13vw,76px)]" />
                <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      running ? (isBreak ? 'bg-success' : 'bg-brand') : 'bg-subtle-foreground',
                      running && 'animate-pulse',
                    )}
                  />
                  {running ? PHASE_LABEL[phase] : status === 'paused' ? 'Paused' : 'Ready'}
                </p>
              </div>
            </TimerRing>
            <AnimatePresence>{burstFresh && lastCompleted && <Burst key={lastCompleted.id} id={lastCompleted.id} />}</AnimatePresence>
          </div>

          {/* cycle progress */}
          <div className="flex items-center gap-2" role="img" aria-label={`${cycle} of ${longEvery} focus sessions before a long break`}>
            {Array.from({ length: longEvery }, (_, i) => (
              <motion.span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length indicator
                key={i}
                animate={{ scale: i < cycle ? 1 : 0.8, backgroundColor: i < cycle ? 'var(--brand)' : 'var(--muted)' }}
                transition={spring.bouncy}
                className="size-2.5 rounded-full"
              />
            ))}
            <span className="ml-1 text-xs text-muted-foreground">
              {phase === 'focus' ? `Session ${Math.min(cycle + 1, longEvery)} of ${longEvery}` : `Up next: ${PHASE_LABEL[nextPhase].toLowerCase()}`}
            </span>
          </div>

          {/* controls */}
          <div className="flex items-center gap-4">
            <IconButton label="Reset" shortcut="R" size="icon-lg" variant="outline" onClick={reset}>
              <RotateCcw />
            </IconButton>
            <motion.button
              type="button"
              onClick={toggle}
              whileTap={{ scale: 0.92 }}
              transition={spring.snappy}
              aria-label={primaryLabel}
              className={cn(
                'relative grid size-[72px] place-items-center rounded-lg text-brand-foreground shadow-brand outline-offset-4 transition-[filter] hover:brightness-110',
                isBreak ? 'bg-success' : 'bg-brand',
              )}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={running ? 'pause' : 'play'}
                  initial={{ scale: 0.4, opacity: 0, rotate: -45 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  exit={{ scale: 0.4, opacity: 0, rotate: 45 }}
                  transition={{ duration: 0.16 }}
                  className="grid place-items-center"
                >
                  {running ? <Pause className="size-7 fill-current" /> : <Play className="ml-1 size-7 fill-current" />}
                </motion.span>
              </AnimatePresence>
            </motion.button>
            <IconButton label="Skip to next phase" size="icon-lg" variant="outline" onClick={skip}>
              <SkipForward />
            </IconButton>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            {primaryLabel} · <kbd className="rounded-sm border bg-muted px-1 font-mono text-[10px]">Space</kbd>
          </p>

          {/* intent */}
          <div className="w-full max-w-md space-y-2 border-t pt-6">
            <InputGroup
              value={intent}
              maxLength={80}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="What are you focusing on?"
              aria-label="Focus intention"
              leading={<Timer />}
            />
            <Select
              size="sm"
              aria-label="Link a Kanban task"
              value={linked ? linked.id : NO_TASK}
              onValueChange={(v) => setLinkedTask(v === NO_TASK ? null : v)}
              options={taskOptions}
            />
          </div>
        </Card>

        {/* ── Stats ── */}
        <div className="space-y-6">
          <Card className="gap-5">
            <Stat icon={Flame} label="Today" value={formatMinutes(today.minutes)} sub={pluralize(today.sessions, 'focus session')} />
            <div className="h-px bg-border" />
            <div className="grid grid-cols-2 gap-4">
              <Stat icon={Trophy} label="Streak" value={`${streakDays}d`} sub={streakDays ? 'keep it going' : 'start today'} />
              <Stat icon={CheckCircle2} label="All time" value={formatMinutes(totalMin)} sub="focused" />
            </div>
          </Card>

          <Card title="Last 7 days" action={<Badge mono>{formatMinutes(week.reduce((m, d) => m + d.minutes, 0))}</Badge>}>
            <div className="flex h-28 gap-2" role="img" aria-label="Focus minutes per day for the last 7 days">
              {week.map((d, i) => {
                const isToday = i === week.length - 1;
                const pct = d.minutes ? Math.max(8, (d.minutes / maxMin) * 100) : 0;
                return (
                  <div key={d.key} className="flex flex-1 flex-col items-center gap-1.5" title={`${d.minutes} min · ${pluralize(d.sessions, 'session')}`}>
                    <div className="flex w-full flex-1 items-end">
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: `${pct}%` }}
                        transition={{ ...spring.soft, delay: i * 0.04 }}
                        className={cn('w-full rounded-md', isToday ? 'bg-brand' : 'bg-brand/35')}
                        style={{ minHeight: d.minutes ? 4 : 0 }}
                      />
                      {!d.minutes && <div className="h-1 w-full rounded-full bg-muted" />}
                    </div>
                    <span className={cn('text-[10px] font-medium', isToday ? 'text-foreground' : 'text-subtle-foreground')}>
                      {d.date.toLocaleDateString(undefined, { weekday: 'narrow' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Recent sessions">
            {recent.length === 0 ? (
              <EmptyState icon={Timer} title="No sessions yet" description="Finish a focus session and it shows up here." className="border-0 p-4" />
            ) : (
              <ul className="-mx-1 space-y-0.5">
                {recent.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-success-soft text-success-text">
                      <CheckCircle2 className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{s.intent ?? 'Focus session'}</span>
                    <span className="tabular shrink-0 text-xs text-muted-foreground">{s.minutes}m</span>
                    <span className="w-14 shrink-0 text-right text-[11px] text-subtle-foreground">{relativeTime(s.completedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            {linked && (
              <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                Linked:{' '}
                <span className="font-medium text-foreground">
                  #{linked.number} {linked.title}
                </span>
              </p>
            )}
          </Card>
        </div>
      </div>

      <TimerSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
