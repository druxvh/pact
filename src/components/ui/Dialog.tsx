import { Dialog as D } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type * as React from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/lib/cn';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

export function DialogContent({
  className,
  size = 'md',
  hideClose = false,
  children,
  ...props
}: Omit<React.ComponentProps<typeof D.Popup>, 'className'> & {
  className?: string;
  size?: keyof typeof sizes;
  hideClose?: boolean;
}) {
  return (
    <D.Portal>
      <D.Backdrop className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[3px] transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
      <D.Viewport className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
        <D.Popup
          className={cn(
            'relative w-full rounded-lg border bg-popover text-popover-foreground shadow-pop outline-none',
            'transition-[opacity,transform] duration-200 ease-out-expo',
            'data-[starting-style]:translate-y-2 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0',
            'data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0',
            sizes[size],
            className,
          )}
          {...props}
        >
          {children}
          {!hideClose && (
            <D.Close
              render={
                <IconButton label="Close" size="icon-sm" className="absolute right-3 top-3" tooltip={false}>
                  <X />
                </IconButton>
              }
            />
          )}
        </D.Popup>
      </D.Viewport>
    </D.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 px-5 pb-1 pt-5 pr-12', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: Omit<React.ComponentProps<typeof D.Title>, 'className'> & { className?: string }) {
  return <D.Title className={cn('text-base font-semibold tracking-tight', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: Omit<React.ComponentProps<typeof D.Description>, 'className'> & { className?: string }) {
  return <D.Description className={cn('text-[13px] text-muted-foreground', className)} {...props} />;
}

export function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('flex items-center justify-end gap-2 px-5 pb-5 pt-1', className)} {...props} />;
}
