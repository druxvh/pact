import { Tooltip as T } from '@base-ui/react/tooltip';
import type * as React from 'react';
import { Kbd } from '@/components/ui/Kbd';

/** Mount once near the root. A short delay, then instant for neighbouring tooltips. */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <T.Provider delay={380} closeDelay={0} timeout={400}>
      {children}
    </T.Provider>
  );
}

type Props = {
  content: React.ReactNode;
  shortcut?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
  /** The single element that triggers the tooltip. */
  children: React.ReactElement<Record<string, unknown>>;
};

export function Tooltip({ content, shortcut, side = 'top', align = 'center', disabled, children }: Props) {
  if (!content) return children;
  return (
    <T.Root disabled={disabled}>
      <T.Trigger render={children} />
      <T.Portal>
        <T.Positioner side={side} align={align} sideOffset={8} className="z-[100]">
          <T.Popup className="popup-motion flex items-center gap-2 rounded-md border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md">
            {content}
            {shortcut && <Kbd className="h-4 min-w-4 px-0.5">{shortcut}</Kbd>}
          </T.Popup>
        </T.Positioner>
      </T.Portal>
    </T.Root>
  );
}
