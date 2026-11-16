import { useEffect, useState } from 'react';
import { AnalogClock } from '@/features/home/AnalogClock';
import { useHomeLayoutStore } from '@/features/home/layout';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useUserStore } from '@/store/useUserStore';

/** Re-renders on the minute (or every second when seconds are shown), aligned to the boundary rather than drifting. */
function useNow(everySecond: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const step = everySecond ? 1000 : 60_000;
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(
        () => {
          setNow(new Date());
          schedule();
        },
        step - (Date.now() % step) + 20,
      );
    };
    setNow(new Date());
    schedule();
    // Waking from sleep / tab restored: resync immediately.
    const onVisible = () => document.visibilityState === 'visible' && setNow(new Date());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [everySecond]);
  return now;
}

function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Good night';
}

/** “Good evening, Sam · Monday, 16 November” — either half can be switched off. */
function DateLine({ now, className }: { now: Date; className: string }) {
  const showGreeting = useSettingsStore((s) => s.showGreeting);
  const showDate = useHomeLayoutStore((s) => s.layout.showDate);
  const name = useUserStore((s) => s.currentUser.displayName);
  if (!showGreeting && !showDate) return null;

  const first = name.trim().split(/\s+/)[0] ?? '';
  const named = first && first.toLowerCase() !== 'you';
  const date = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(now);

  return (
    <p className={className}>
      {showGreeting && (
        <>
          {greetingFor(now.getHours())}
          {named && <span className="text-foreground">, {first}</span>}
          {showDate && <span className="mx-2 text-subtle-foreground">·</span>}
        </>
      )}
      {showDate && date}
    </p>
  );
}

export function Clock() {
  const clock = useSettingsStore((s) => s.clock);
  const style = useHomeLayoutStore((s) => s.layout.clockStyle);
  const wantSeconds = useHomeLayoutStore((s) => s.layout.showSeconds);
  const showSeconds = wantSeconds && (style === 'digital' || style === 'analog');
  const now = useNow(showSeconds);

  const hour12 = clock === 'auto' ? undefined : clock === '12h';
  const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12 }).formatToParts(now);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
  const period = parts.find((p) => p.type === 'dayPeriod')?.value;
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const spoken = `${hour}:${minute}${period ? ` ${period}` : ''}`;

  if (style === 'none') return <DateLine now={now} className="text-center text-xl font-light tracking-tight text-muted-foreground sm:text-2xl" />;

  if (style === 'analog') {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <AnalogClock now={now} showSeconds={showSeconds} label={spoken} />
        <DateLine now={now} className="text-[15px] text-muted-foreground" />
      </div>
    );
  }

  const compact = style === 'compact';
  return (
    <div className="text-center">
      <h1 className="tabular flex items-baseline justify-center gap-2 font-light leading-none tracking-tighter">
        <span className={compact ? 'text-[clamp(44px,7vw,64px)]' : 'text-[clamp(64px,11vw,112px)]'}>
          <span className="sr-only">{spoken}</span>
          <span aria-hidden="true">
            {hour}
            <span className="mx-[0.04em] animate-pulse text-brand-text/80 [animation-duration:2s]">:</span>
            {minute}
            {showSeconds && !compact && (
              <span className="ml-[0.12em] align-baseline text-[0.36em] font-normal text-muted-foreground">
                <span className="mr-[0.04em] opacity-60">:</span>
                {seconds}
              </span>
            )}
          </span>
        </span>
        {period && (
          <span
            className={
              compact
                ? 'text-[13px] font-normal uppercase tracking-widest text-muted-foreground'
                : 'text-[clamp(16px,2vw,24px)] font-normal uppercase tracking-widest text-muted-foreground'
            }
          >
            {period}
          </span>
        )}
      </h1>
      <DateLine now={now} className={compact ? 'mt-2 text-sm text-muted-foreground' : 'mt-3 text-[15px] text-muted-foreground'} />
    </div>
  );
}
