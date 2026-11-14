import type * as React from 'react';
import { cn } from '@/lib/cn';

const field =
  'w-full rounded-md border border-input bg-card/50 text-sm text-foreground outline-none ' +
  'placeholder:text-subtle-foreground transition-[border-color,box-shadow,background-color] duration-150 ' +
  'hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/15 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/15';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(field, 'h-9 px-3', className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'min-h-20 resize-none px-3 py-2 leading-relaxed', className)} {...props} />;
}

/** Input with a leading icon and/or trailing slot (kbd hint, clear button, …). */
export function InputGroup({
  leading,
  trailing,
  className,
  inputClassName,
  ...props
}: React.ComponentProps<'input'> & {
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  inputClassName?: string;
}) {
  return (
    <div className={cn('relative flex items-center', className)}>
      {leading && <span className="pointer-events-none absolute left-3 flex items-center text-muted-foreground [&_svg]:size-4">{leading}</span>}
      <input className={cn(field, 'h-9', leading ? 'pl-9' : 'pl-3', trailing ? 'pr-12' : 'pr-3', inputClassName)} {...props} />
      {trailing && <span className="absolute right-2 flex items-center gap-1">{trailing}</span>}
    </div>
  );
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('mb-1.5 block text-xs font-medium text-muted-foreground', className)} {...props} />;
}
