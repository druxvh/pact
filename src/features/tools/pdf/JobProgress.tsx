import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui';
import { fraction, type Progress } from '@/features/tools/lib/pdf/job';
import { cn } from '@/lib/cn';

/**
 * The progress bar + Cancel every PDF tool shows while a job runs. Indeterminate until the job reports a total.
 * Cancel really stops the work (the worker is terminated). The button takes focus when the panel appears, because the
 * button that started the job is disabled at that moment and keyboard focus would otherwise fall back to the page.
 */
export function JobProgress({
  progress,
  onCancel,
  stacked,
  className,
}: {
  progress: Progress | null;
  onCancel: () => void;
  /** Always put Cancel under the bar (for narrow side panels). Otherwise it sits beside the bar from the `sm` breakpoint up. */
  stacked?: boolean;
  className?: string;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);

  const value = progress ? fraction(progress) : null;
  const percent = value === null ? undefined : Math.round(value * 100);
  const label = progress?.label ?? 'Working…';

  return (
    <div className={cn('flex flex-col gap-3 rounded-lg border bg-card p-3', !stacked && 'sm:flex-row sm:items-center', className)}>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
          <span className="truncate" title={label}>
            {label}
          </span>
          {percent !== undefined && <span className="tabular shrink-0 text-muted-foreground">{percent}%</span>}
        </div>
        <div
          role="progressbar"
          aria-label="PDF progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={percent === undefined ? label : `${label} — ${percent}%`}
          className="relative h-1.5 overflow-hidden rounded-full bg-muted"
        >
          {percent === undefined ? (
            <span className="absolute inset-0 animate-shimmer rounded-full bg-[linear-gradient(90deg,var(--muted)_20%,var(--brand)_50%,var(--muted)_80%)] bg-[length:300%_100%]" />
          ) : (
            <span className="block h-full rounded-full bg-brand transition-[width] duration-200 ease-out" style={{ width: `${percent}%` }} />
          )}
        </div>
      </div>
      <Button ref={cancel} variant="outline" onClick={onCancel} className={cn('w-full', !stacked && 'sm:w-auto')}>
        Cancel
      </Button>
    </div>
  );
}
