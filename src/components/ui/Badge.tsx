import type * as React from 'react';
import { cn } from '@/lib/cn';

const tones = {
  neutral: 'bg-muted text-muted-foreground',
  brand: 'bg-brand-soft text-brand-text',
  success: 'bg-success-soft text-success-text',
  warning: 'bg-warning-soft text-warning-text',
  destructive: 'bg-destructive-soft text-destructive-text',
  outline: 'border text-muted-foreground',
} as const;

export function Badge({
  tone = 'neutral',
  mono,
  className,
  ...props
}: React.ComponentProps<'span'> & { tone?: keyof typeof tones; mono?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[11px] font-medium leading-none [&_svg]:size-3',
        mono && 'font-mono',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
