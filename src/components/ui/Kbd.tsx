import { cn } from '@/lib/cn';

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 select-none items-center justify-center rounded-sm border bg-muted px-1 font-mono text-[10px] font-medium leading-none text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
