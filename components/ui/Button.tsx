import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost';
};

export function Button({
  className,
  variant = 'primary',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition',
        variant === 'primary' &&
          'bg-sky-500 text-slate-950 hover:bg-sky-400 disabled:opacity-50',
        variant === 'ghost' &&
          'bg-transparent text-slate-200 hover:bg-slate-800',
        className,
      )}
      {...props}
    />
  );
}
