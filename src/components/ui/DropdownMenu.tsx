import { Menu as M } from '@base-ui/react/menu';
import type * as React from 'react';
import { cn } from '@/lib/cn';

export const DropdownMenu = M.Root;
export const DropdownTrigger = M.Trigger;

export function DropdownContent({
  className,
  side = 'bottom',
  align = 'end',
  sideOffset = 6,
  children,
}: {
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  children: React.ReactNode;
}) {
  return (
    <M.Portal>
      <M.Positioner side={side} align={align} sideOffset={sideOffset} collisionPadding={12} className="z-50">
        <M.Popup
          className={cn(
            'popup-motion min-w-44 rounded-xl border bg-popover p-1 text-popover-foreground shadow-pop outline-none',
            className,
          )}
        >
          {children}
        </M.Popup>
      </M.Positioner>
    </M.Portal>
  );
}

export function DropdownItem({
  className,
  destructive,
  icon,
  shortcut,
  children,
  ...props
}: Omit<React.ComponentProps<typeof M.Item>, 'className'> & {
  className?: string;
  destructive?: boolean;
  icon?: React.ReactNode;
  shortcut?: string;
}) {
  return (
    <M.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none transition-colors',
        'data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        destructive && 'text-destructive-text data-[highlighted]:bg-destructive-soft',
        '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        destructive && '[&_svg]:text-destructive-text',
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {shortcut && <span className="ml-4 font-mono text-[10px] text-subtle-foreground">{shortcut}</span>}
    </M.Item>
  );
}

export function DropdownSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-border" />;
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
      {children}
    </div>
  );
}
