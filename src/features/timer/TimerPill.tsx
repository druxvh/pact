import { Pause, Timer } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { PresetIcon } from '@/features/timer/PresetIcon';
import { activePreset, PHASE_LABEL, useTimerStore } from '@/features/timer/store';
import { useCountdown } from '@/features/timer/useCountdown';
import { cn } from '@/lib/cn';
import { formatClock } from '@/lib/format';
import { spring } from '@/lib/motion';
import { useNavStore } from '@/store/useNavStore';

/** Compact countdown in the top bar while a timer is running/paused — click to open Focus. */
export function TimerPill() {
  const { status, phase, seconds } = useCountdown();
  const go = useNavStore((s) => s.go);
  const preset = useTimerStore(activePreset);
  const onTimerPage = useNavStore((s) => s.section === 'timer');
  const visible = status !== 'idle' && !onTimerPage;

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          initial={{ opacity: 0, scale: 0.85, width: 0 }}
          animate={{ opacity: 1, scale: 1, width: 'auto' }}
          exit={{ opacity: 0, scale: 0.85, width: 0 }}
          transition={spring.soft}
          onClick={() => go('timer')}
          aria-label={`${PHASE_LABEL[phase]} timer ${status === 'paused' ? 'paused' : 'running'}, ${formatClock(seconds)} left. Open Focus.`}
          className={cn(
            'mr-1 flex h-8 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap rounded-lg border px-3 text-[13px] font-medium transition-colors',
            status === 'running' ? 'border-brand/40 bg-brand-soft text-brand-text hover:bg-brand/20' : 'bg-muted text-muted-foreground hover:bg-accent',
          )}
        >
          {status === 'running' ? (
            <span className="relative grid size-4 place-items-center">
              <span className="absolute size-2 animate-pulse-ring rounded-full bg-brand" />
              {preset && phase === 'focus' ? <PresetIcon icon={preset.icon} className="size-3.5" /> : <Timer className="size-3.5" />}
            </span>
          ) : (
            <Pause className="size-3.5" />
          )}
          <span className="tabular font-mono">{formatClock(seconds)}</span>
          <span className="hidden text-xs font-normal opacity-70 lg:inline">{PHASE_LABEL[phase]}</span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
