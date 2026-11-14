import { Dialog as D } from '@base-ui/react/dialog';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';

type PromptOptions = {
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  initial?: string;
  confirmLabel?: string;
  maxLength?: number;
  /** Return an error message to block submission. */
  validate?: (value: string) => string | null;
};

type State = {
  open: boolean;
  options: PromptOptions | null;
  resolve: ((value: string | null) => void) | null;
};

const usePromptStore = create<State>(() => ({ open: false, options: null, resolve: null }));

/**
 * Promise-based replacement for `window.prompt()`.
 * Resolves with the trimmed text, or `null` if dismissed.
 */
export function promptText(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    usePromptStore.getState().resolve?.(null);
    usePromptStore.setState({ open: true, options, resolve });
  });
}

function settle(value: string | null) {
  const { resolve } = usePromptStore.getState();
  resolve?.(value);
  usePromptStore.setState({ open: false, resolve: null });
}

/** Mount once near the root. */
export function PromptHost() {
  const { open, options } = usePromptStore();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(options?.initial ?? '');
      setError(null);
    }
  }, [open, options]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) {
      setError('Please enter a name');
      return;
    }
    const err = options?.validate?.(v) ?? null;
    if (err) {
      setError(err);
      return;
    }
    settle(v);
  };

  return (
    <D.Root open={open} onOpenChange={(next) => !next && settle(null)}>
      <D.Portal>
        <D.Backdrop className="fixed inset-0 z-[70] bg-black/55 backdrop-blur-[3px] transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0" />
        <D.Viewport className="fixed inset-0 z-[70] grid place-items-center p-4">
          <D.Popup className="w-full max-w-sm rounded-2xl border bg-popover text-popover-foreground shadow-pop outline-none transition-[opacity,transform] duration-200 ease-out-expo data-[starting-style]:translate-y-2 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0">
            <form onSubmit={submit} className="p-5">
              <D.Title className="text-base font-semibold tracking-tight">{options?.title}</D.Title>
              {options?.description && <D.Description className="mt-1 text-[13px] text-muted-foreground">{options.description}</D.Description>}
              <div className="mt-4">
                <Label htmlFor="prompt-input">{options?.label ?? 'Name'}</Label>
                <Input
                  id="prompt-input"
                  autoFocus
                  value={value}
                  maxLength={options?.maxLength ?? 40}
                  placeholder={options?.placeholder}
                  aria-invalid={error ? true : undefined}
                  onChange={(e) => {
                    setValue(e.target.value);
                    setError(null);
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                />
                {error && <p className="mt-1.5 text-xs text-destructive-text">{error}</p>}
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => settle(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  {options?.confirmLabel ?? 'Save'}
                </Button>
              </div>
            </form>
          </D.Popup>
        </D.Viewport>
      </D.Portal>
    </D.Root>
  );
}
