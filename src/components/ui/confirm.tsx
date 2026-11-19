import { AlertDialog as A } from '@base-ui/react/alert-dialog';
import { create } from 'zustand';
import { Button } from '@/components/ui/Button';

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type State = {
  open: boolean;
  options: ConfirmOptions | null;
  resolve: ((value: boolean) => void) | null;
};

const useConfirmStore = create<State>(() => ({ open: false, options: null, resolve: null }));

/**
 * Promise-based replacement for `window.confirm()` — themed, keyboard-accessible,
 * and never blocks the page. `if (await confirm({ title: 'Delete board?' })) …`
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().resolve?.(false); // settle any dangling prompt
    useConfirmStore.setState({ open: true, options, resolve });
  });
}

function settle(value: boolean) {
  const { resolve } = useConfirmStore.getState();
  resolve?.(value);
  useConfirmStore.setState({ open: false, resolve: null });
}

/** Mount once near the root. */
export function ConfirmHost() {
  const { open, options } = useConfirmStore();
  return (
    <A.Root open={open} onOpenChange={(next) => !next && settle(false)}>
      <A.Portal>
        <A.Backdrop className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-[3px] transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <A.Viewport className="fixed inset-0 z-[70] grid place-items-center p-4">
          <A.Popup className="w-full max-w-sm rounded-lg border bg-popover p-5 text-popover-foreground shadow-pop outline-none transition-[opacity,transform] duration-200 ease-out-expo data-[starting-style]:translate-y-2 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0">
            <A.Title className="text-base font-semibold tracking-tight">{options?.title}</A.Title>
            {options?.description && <A.Description className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{options.description}</A.Description>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => settle(false)}>
                {options?.cancelLabel ?? 'Cancel'}
              </Button>
              <Button variant={options?.destructive ? 'destructive' : 'primary'} onClick={() => settle(true)}>
                {options?.confirmLabel ?? 'Confirm'}
              </Button>
            </div>
          </A.Popup>
        </A.Viewport>
      </A.Portal>
    </A.Root>
  );
}
