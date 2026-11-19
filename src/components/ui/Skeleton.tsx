import { cn } from '@/lib/cn';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--muted)_25%,var(--accent)_37%,var(--muted)_63%)] bg-[length:400%_100%]',
        className,
      )}
      {...props}
    />
  );
}
