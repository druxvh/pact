import { Flame, Timer } from 'lucide-react';
import { Button } from '@/components/ui';
import { OpenLink, WidgetCard } from '@/features/home/widgets/WidgetCard';
import { streak, todayStats } from '@/features/timer/stats';
import { useTimerStore } from '@/features/timer/store';
import { formatMinutes, pluralize } from '@/lib/format';
import { useNavStore } from '@/store/useNavStore';

/** Focus time so far today, the current streak, and a way into the timer. */
export function FocusWidget() {
  const sessions = useTimerStore((s) => s.sessions);
  const status = useTimerStore((s) => s.status);
  const go = useNavStore((s) => s.go);

  const today = todayStats(sessions);
  const days = streak(sessions);
  const running = status === 'running';

  return (
    <WidgetCard icon={Timer} title="Focus" action={<OpenLink to="timer" label="Timer" />}>
      <div className="flex flex-1 flex-col justify-between gap-4">
        <div>
          <p className="tabular text-4xl font-light leading-none tracking-tight">{today.minutes > 0 ? formatMinutes(today.minutes) : '0m'}</p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {today.sessions > 0 ? `${pluralize(today.sessions, 'session')} today` : 'No focus sessions yet today'}
          </p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Flame className={days > 0 ? 'size-4 text-brand-text' : 'size-4'} aria-hidden="true" />
            {days > 0 ? `${pluralize(days, 'day')} in a row` : 'Start a streak'}
          </span>
          <Button variant={running ? 'soft' : 'primary'} size="sm" onClick={() => go('timer')}>
            {running ? 'Timer running' : 'Start focus'}
          </Button>
        </div>
      </div>
    </WidgetCard>
  );
}
