/**
 * The few building blocks every Settings section is made of, so the page has one calm rhythm:
 *
 *   Section = a small heading (icon · title · one-line description · optional action) above ONE bordered list;
 *   Row     = label + description on the left, the current value or a compact control on the right, hairline dividers.
 *
 * No cards inside cards: anything bigger than a row (a gallery, a list, a form) lives in a popover or dialog opened from
 * a summary row, so you never have to scroll inside a section to understand it.
 */
import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import type { ComponentProps, ReactNode } from 'react';
import { PopoverContent } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fadeUp } from '@/lib/motion';

export function SettingsSection({
  id,
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Small control at the right of the heading (e.g. a "Reset"). */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <motion.section variants={fadeUp} id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4">
      <header className="mb-1.5 flex min-h-7 items-center gap-2 px-1">
        <Icon className="size-3.5 shrink-0 text-brand-text" aria-hidden="true" />
        <h2 id={`${id}-title`} className="shrink-0 text-[13px] font-semibold tracking-tight">
          {title}
        </h2>
        {description && <p className="min-w-0 flex-1 py-0.5 text-xs leading-snug text-muted-foreground sm:truncate sm:py-0">{description}</p>}
        {action && <div className="ml-auto shrink-0">{action}</div>}
      </header>
      <div className="divide-y divide-border/70 rounded-lg border bg-card px-4 shadow-xs">{children}</div>
    </motion.section>
  );
}

/** One setting. The control wraps under the text on narrow screens instead of squeezing it. */
export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** The id of the single control this row labels (omit for groups — give the group its own aria-label). */
  htmlFor?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2', className)}>
      <div className="min-w-0 flex-1 basis-36">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-[13px] font-medium leading-5">
            {label}
          </label>
        ) : (
          <p className="text-[13px] font-medium leading-5">{label}</p>
        )}
        {description && <div className="text-xs leading-snug text-muted-foreground">{description}</div>}
      </div>
      {children ? <div className="flex max-w-full shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}

/** A segmented control that scrolls sideways instead of overflowing on very narrow screens. */
export function ScrollX({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('no-scrollbar -m-1 max-w-full overflow-x-auto overflow-y-hidden p-1', className)}>{children}</div>;
}

/**
 * A popover panel: never wider than the screen, and (PopoverContent's own `max-height: var(--available-height)` +
 * `overflow: auto`) it scrolls inside itself instead of running off a short window.
 */
export function Panel({ className, children, ...props }: ComponentProps<typeof PopoverContent>) {
  return (
    <PopoverContent {...props} className={cn('w-[min(22rem,calc(100vw-1.5rem))] p-3', className)}>
      {children}
    </PopoverContent>
  );
}
