import * as React from 'react';
import { cn } from '@/lib/cn';

// Base UI-inspired + shadcn API — minimal rounded-sm, premium motion
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'icon';
};

const base =
  'inline-flex items-center justify-center rounded-sm text-sm font-medium transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]';

const variants = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
  outline: 'border border-input bg-transparent hover:bg-accent hover:text-accent-foreground',
} as const;

const sizes = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3.5 py-2',
  icon: 'h-8 w-8 p-0',
} as const;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', type = 'button', ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        // Base UI: data-variant for styling hooks, ensures a11y
        data-variant={variant}
        data-size={size}
        className={cn(base, variants[variant], sizes[size], className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
