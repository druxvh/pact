import { Tabs } from '@base-ui/react/tabs';
import type * as React from 'react';
import { cn } from '@/lib/cn';

export type SegmentedOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Accessible name when the label is icon-only. */
  ariaLabel?: string;
};

type Props<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  size?: 'sm' | 'md';
  className?: string;
  fullWidth?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
};

/** Pill-style single-select with a sliding highlight (pure CSS, driven by Base UI's active-tab variables). */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  size = 'md',
  className,
  fullWidth,
  disabled,
  ...aria
}: Props<T>) {
  return (
    <Tabs.Root value={value} onValueChange={(v) => onValueChange(v as T)}>
      <Tabs.List
        aria-label={aria['aria-label']}
        className={cn(
          'relative inline-flex items-center rounded-lg bg-muted p-0.5',
          fullWidth && 'flex w-full',
          className,
        )}
      >
        {options.map((o) => (
          <Tabs.Tab
            key={o.value}
            value={o.value}
            aria-label={o.ariaLabel}
            disabled={disabled}
            className={cn(
              disabled && 'cursor-not-allowed opacity-50',
              'relative z-10 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium text-muted-foreground outline-none transition-colors duration-150',
              'hover:text-foreground data-[active]:text-foreground [&_svg]:size-3.5',
              size === 'sm' ? 'h-6 px-2.5 text-xs' : 'h-7 px-3 text-[13px]',
              fullWidth && 'flex-1',
            )}
          >
            {o.icon}
            {o.label}
          </Tabs.Tab>
        ))}
        <Tabs.Indicator className="absolute top-0 left-0 z-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) translate-y-(--active-tab-top) rounded-md bg-background shadow-sm ring-1 ring-border/60 transition-[translate,width,height] duration-300 ease-out-expo" />
      </Tabs.List>
    </Tabs.Root>
  );
}
