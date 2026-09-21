import * as React from 'react';
import { cn } from '@/lib/cn';

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  title?: string;
  action?: React.ReactNode;
  hover?: boolean;
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ title, action, className, children, hover = false, ...props }, ref) => {
    return (
      <section
        ref={ref}
        data-slot="card"
        className={cn(
          'flex flex-col rounded-sm border bg-card text-card-foreground p-4 shadow-sm',
          'transition-colors duration-150 ease-out',
          hover && 'hover:border-ring/50 hover:bg-accent/30 cursor-pointer',
          className,
        )}
        {...props}
      >
        {(title || action) && (
          <header className="mb-3 flex items-center justify-between gap-3">
            {title ? (
              <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
            ) : (
              <span />
            )}
            {action}
          </header>
        )}
        {children}
      </section>
    );
  },
);
Card.displayName = 'Card';

// Card inner wrapper that adds consistent padding — use where needed
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="card-content" className={cn('p-4', className)} {...props} />;
}
