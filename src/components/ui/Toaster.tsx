import { Toaster as Sonner } from 'sonner';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useThemeStore } from '@/store/useThemeStore';

/** The phone/tablet bottom tab bar (AppShell's MobileNav: `h-12` + the safe area) shows below `md`; toasts sit above it, not on it. */
const ABOVE_TAB_BAR = 'calc(60px + env(safe-area-inset-bottom))';

/** Sonner, themed with pact's tokens. Mount once at the root. */
export function Toaster() {
  const theme = useThemeStore((s) => s.resolved);
  const tabBar = !useMediaQuery('(min-width: 768px)');
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      gap={8}
      // `offset` applies above Sonner's 600px phone breakpoint, `mobileOffset` below it.
      offset={tabBar ? { bottom: ABOVE_TAB_BAR, right: 20, left: 20, top: 20 } : 20}
      mobileOffset={{ bottom: ABOVE_TAB_BAR, left: 16, right: 16, top: 16 }}
      visibleToasts={4}
      toastOptions={{
        classNames: {
          toast: '!rounded-lg !border !border-border !bg-popover !text-popover-foreground !shadow-pop !font-sans !text-[13px]',
          description: '!text-muted-foreground',
          actionButton: '!rounded-md !bg-brand !text-brand-foreground !font-medium',
          cancelButton: '!rounded-md !bg-muted !text-muted-foreground',
        },
      }}
    />
  );
}
