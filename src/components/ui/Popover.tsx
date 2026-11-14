import { Popover as P } from '@base-ui/react/popover';
import type * as React from 'react';
import { cn } from '@/lib/cn';

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverClose = P.Close;

type ContentProps = Omit<React.ComponentProps<typeof P.Popup>, 'className'> & {
  className?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
};

export function PopoverContent({
  className,
  side = 'bottom',
  align = 'center',
  sideOffset = 8,
  children,
  ...props
}: ContentProps) {
  return (
    <P.Portal>
      <P.Positioner side={side} align={align} sideOffset={sideOffset} collisionPadding={12} className="z-50">
        <P.Popup
          className={cn(
            'popup-motion max-h-(--available-height) max-w-(--available-width) overflow-auto rounded-xl border bg-popover text-popover-foreground shadow-pop outline-none',
            className,
          )}
          {...props}
        >
          {children}
        </P.Popup>
      </P.Positioner>
    </P.Portal>
  );
}
