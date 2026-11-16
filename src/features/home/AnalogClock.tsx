const TICKS = Array.from({ length: 60 }, (_, i) => i);

/**
 * An analog face drawn in SVG from the theme tokens (so it follows light/dark and the accent colour).
 *
 * Hand angles are derived from an ever-increasing local timestamp rather than `getHours() % 12`, so a hand never
 * "wraps" from 359° back to 0° (which would spin it backwards through the CSS transition).
 */
export function AnalogClock({ now, showSeconds, label }: { now: Date; showSeconds: boolean; label: string }) {
  const local = now.getTime() - now.getTimezoneOffset() * 60_000;
  const hour = (local / 3_600_000 / 12) * 360;
  const minute = (local / 60_000 / 60) * 360;
  const second = Math.floor(local / 1000 / 60) * 360 + (Math.floor(local / 1000) % 60) * 6;

  const hand = (deg: number, len: number, width: number, cls: string, smooth: boolean) => (
    <line
      x1="100"
      y1="100"
      x2="100"
      y2={100 - len}
      strokeWidth={width}
      strokeLinecap="round"
      className={cls}
      style={{
        transform: `rotate(${deg}deg)`,
        transformOrigin: '100px 100px',
        transition: smooth ? 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)' : undefined,
      }}
    />
  );

  return (
    <svg viewBox="0 0 200 200" role="img" aria-label={label} className="size-[clamp(168px,24vw,224px)]">
      <circle cx="100" cy="100" r="96" className="fill-card/60 stroke-border" strokeWidth="1.5" />
      {TICKS.map((i) => {
        const major = i % 5 === 0;
        return (
          <line
            key={i}
            x1="100"
            y1={major ? 10 : 12}
            x2="100"
            y2={major ? 22 : 16}
            strokeWidth={major ? 2.5 : 1}
            strokeLinecap="round"
            className={major ? 'stroke-foreground/70' : 'stroke-foreground/25'}
            style={{ transform: `rotate(${i * 6}deg)`, transformOrigin: '100px 100px' }}
          />
        );
      })}
      {hand(hour, 46, 5, 'stroke-foreground', true)}
      {hand(minute, 68, 3.5, 'stroke-foreground', true)}
      {showSeconds && hand(second, 78, 1.5, 'stroke-brand', false)}
      <circle cx="100" cy="100" r="4.5" className="fill-brand" />
      <circle cx="100" cy="100" r="1.8" className="fill-card" />
    </svg>
  );
}
