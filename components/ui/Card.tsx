import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  title?: string;
  action?: ReactNode;
};

export function Card({ title, action, className, children, ...props }: CardProps) {
  return (
    <section
      className={cn(
        'flex flex-col rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl shadow-slate-950/40',
        className,
      )}
      {...props}
    >
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title ? (
            <h2 className="text-sm font-semibold tracking-wide text-slate-200">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
