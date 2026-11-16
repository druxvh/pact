import type * as React from 'react';
import { cn } from '@/lib/cn';

type CardProps = Omit<React.ComponentProps<'section'>, 'title'> & {
  /** Optional header title (shorthand for a simple card). */
  title?: React.ReactNode;
  /** Optional header action slot, aligned right of the title. */
  action?: React.ReactNode;
  /** Lift + border highlight on hover. */
  interactive?: boolean;
  /** Cursor-following brand glow on hover. */
  spotlight?: boolean;
};

export function Card({ title, action, interactive, spotlight, className, children, ...props }: CardProps) {
  return (
    <section
      data-spotlight={spotlight ? '' : undefined}
      className={cn(
        'flex flex-col rounded-lg border bg-card p-4 text-card-foreground shadow-xs',
        'transition-[border-color,box-shadow,transform,background-color] duration-200 ease-out-quart',
        interactive && 'cursor-pointer hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md',
        spotlight && 'spotlight',
        className,
      )}
      {...props}
    >
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title ? <h2 className="text-sm font-semibold tracking-tight">{title}</h2> : <span />}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 className={cn('text-sm font-semibold tracking-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-[13px] text-muted-foreground', className)} {...props} />;
}
