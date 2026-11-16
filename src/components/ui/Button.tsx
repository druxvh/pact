import { Button as BaseButton } from '@base-ui/react/button';
import type * as React from 'react';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'soft' | 'destructive' | 'danger' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon-xs' | 'icon-sm' | 'icon' | 'icon-lg';

const base =
  'relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium ' +
  'transition-[background-color,color,border-color,box-shadow,transform,opacity,filter] duration-150 ease-out-quart ' +
  'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.28),0_1px_2px_oklch(0_0_0/0.25)] hover:brightness-110 active:brightness-95',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
  outline: 'border border-input bg-transparent text-foreground hover:bg-accent',
  ghost: 'text-muted-foreground hover:bg-accent hover:text-foreground data-[pressed]:bg-accent data-[popup-open]:bg-accent data-[popup-open]:text-foreground',
  soft: 'bg-brand-soft text-brand-text hover:bg-brand/25',
  destructive: 'bg-destructive text-destructive-foreground hover:brightness-110',
  danger: 'text-destructive-text hover:bg-destructive-soft',
  link: 'h-auto rounded-sm px-0.5 text-brand-text underline-offset-4 hover:underline active:scale-100',
};

const sizes: Record<ButtonSize, string> = {
  xs: 'h-6 gap-1 rounded-sm px-2 text-xs [&_svg]:size-3.5',
  sm: 'h-7 gap-1.5 rounded-md px-2.5 text-[13px] [&_svg]:size-3.5',
  md: 'h-8 gap-1.5 rounded-md px-3 text-[13px]',
  lg: 'h-10 gap-2 rounded-md px-4 text-sm',
  'icon-xs': 'size-6 rounded-sm [&_svg]:size-3.5',
  'icon-sm': 'size-7 rounded-md [&_svg]:size-3.5',
  icon: 'size-8 rounded-md',
  'icon-lg': 'size-10 rounded-lg [&_svg]:size-[18px]',
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string) {
  return cn(base, sizes[size], variants[variant], className);
}

export type ButtonProps = Omit<React.ComponentProps<typeof BaseButton>, 'className'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  className?: string;
};

export function Button({
  className,
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  type = 'button',
  onClick,
  children,
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      type={type}
      disabled={disabled}
      aria-busy={loading || undefined}
      data-variant={variant}
      // While loading we keep full opacity (so the spinner is visible) but swallow input.
      onClick={loading ? undefined : onClick}
      className={buttonClass(variant, size, cn(loading && 'pointer-events-none', className))}
      {...props}
    >
      {loading && <Spinner className="absolute" />}
      <span className={cn('contents', loading && 'invisible')}>{children}</span>
    </BaseButton>
  );
}
