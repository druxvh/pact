import { Toaster as Sonner } from 'sonner';
import { useThemeStore } from '@/store/useThemeStore';

/** Sonner, themed with pact's tokens. Mount once at the root. */
export function Toaster() {
  const theme = useThemeStore((s) => s.resolved);
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      gap={8}
      offset={20}
      visibleToasts={4}
      toastOptions={{
        classNames: {
          toast: '!rounded-xl !border !border-border !bg-popover !text-popover-foreground !shadow-pop !font-sans !text-[13px]',
          description: '!text-muted-foreground',
          actionButton: '!rounded-md !bg-brand !text-brand-foreground !font-medium',
          cancelButton: '!rounded-md !bg-muted !text-muted-foreground',
        },
      }}
    />
  );
}
