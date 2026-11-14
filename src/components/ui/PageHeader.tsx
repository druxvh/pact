import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/cn';

/** Consistent title block for every section. */
export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-text">
            <Icon className="size-[18px]" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold leading-tight tracking-tight">{title}</h1>
          {description && <p className="truncate text-[13px] text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
