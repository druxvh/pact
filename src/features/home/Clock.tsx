import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useUserStore } from '@/store/useUserStore';

/** Re-renders once a minute, aligned to the minute boundary (not once a second). */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: number;
    const tick = () => {
      setNow(new Date());
      const ms = 60_000 - (Date.now() % 60_000);
      timer = window.setTimeout(tick, ms + 20);
    };
    timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 20);
    // Waking from sleep / tab restored: resync immediately.
    const onVisible = () => document.visibilityState === 'visible' && setNow(new Date());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
}

function greetingFor(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 22) return 'Good evening';
  return 'Good night';
}

export function Clock() {
  const now = useNow();
  const clock = useSettingsStore((s) => s.clock);
  const showGreeting = useSettingsStore((s) => s.showGreeting);
  const name = useUserStore((s) => s.currentUser.displayName);

  const hour12 = clock === 'auto' ? undefined : clock === '12h';
  const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12 }).formatToParts(now);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
  const period = parts.find((p) => p.type === 'dayPeriod')?.value;
  const date = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(now);
  const first = name.trim().split(/\s+/)[0] ?? '';
  const named = first && first.toLowerCase() !== 'you';

  return (
    <div className="text-center">
      <h1 className="tabular flex items-baseline justify-center gap-2 font-light leading-none tracking-tighter">
        <span className="text-[clamp(64px,11vw,112px)]" aria-label={`${hour}:${minute}${period ? ` ${period}` : ''}`}>
          {hour}
          <span className="mx-[0.04em] animate-pulse text-brand-text/80 [animation-duration:2s]">:</span>
          {minute}
        </span>
        {period && <span className="text-[clamp(16px,2vw,24px)] font-normal uppercase tracking-widest text-muted-foreground">{period}</span>}
      </h1>
      <p className="mt-3 text-[15px] text-muted-foreground">
        {showGreeting ? (
          <>
            {greetingFor(now.getHours())}
            {named && <span className="text-foreground">, {first}</span>}
            <span className="mx-2 text-subtle-foreground">·</span>
          </>
        ) : null}
        {date}
      </p>
    </div>
  );
}
