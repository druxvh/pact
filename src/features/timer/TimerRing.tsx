import type * as React from 'react';
import { cn } from '@/lib/cn';

const SIZE = 300;
const STROKE = 10;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

/** Circular progress. The dash offset glides over 1s (linear) between per-second updates → continuous motion. */
export function TimerRing({
  progress,
  running,
  tone = 'brand',
  children,
}: {
  progress: number;
  running: boolean;
  tone?: 'brand' | 'success';
  children: React.ReactNode;
}) {
  return (
    // `--ring-progress` (0 → 1) and `data-tone` are for a style's CSS: Dusk's arc drifts from gold to rose as the time runs.
    <div
      data-ring
      data-tone={tone}
      style={{ '--ring-progress': progress.toFixed(3) } as React.CSSProperties}
      className="relative mx-auto grid aspect-square w-[min(300px,78vw)] place-items-center"
    >
      {/* ambient glow, breathing while running */}
      <div
        aria-hidden="true"
        data-glow
        className={cn(
          'absolute inset-6 rounded-full blur-3xl transition-opacity duration-700',
          tone === 'brand' ? 'bg-brand/30' : 'bg-success/30',
          running ? 'animate-pulse opacity-100 [animation-duration:3s]' : 'opacity-30',
        )}
      />
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="relative size-full -rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id="timer-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={tone === 'brand' ? 'var(--brand)' : 'var(--success)'} />
            <stop offset="100%" stopColor={tone === 'brand' ? 'oklch(0.82 0.17 78)' : 'oklch(0.82 0.15 190)'} />
          </linearGradient>
        </defs>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--muted)" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="url(#timer-ring)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - progress)}
          style={{ transition: running ? 'stroke-dashoffset 1s linear' : 'stroke-dashoffset 0.5s var(--ease-out-expo)' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
