import { Search } from 'lucide-react';
import { NotificationCenter } from '@/app/NotificationCenter';
import { openOmnibox } from '@/app/openOmnibox';
import { ProfileMenu } from '@/app/ProfileMenu';
import { SyncBadge } from '@/app/SyncBadge';
import { Button, IconButton, Kbd, ThemeToggle } from '@/components/ui';
import { TimerPill } from '@/features/timer/TimerPill';
import { cn } from '@/lib/cn';
import { MOD_KEY } from '@/lib/hotkeys';
import { selectSignedIn, useAuthStore } from '@/store/useAuthStore';
import { useNavStore } from '@/store/useNavStore';
import { useUiStore } from '@/store/useUiStore';

export function TopBar() {
  const isHome = useNavStore((s) => s.section === 'home');
  const setSignInOpen = useUiStore((s) => s.setSignInOpen);
  const signedIn = useAuthStore(selectSignedIn);
  const checking = useAuthStore((s) => s.status === 'loading');

  return (
    <header
      className={cn(
        'z-10 flex h-14 shrink-0 items-center gap-3 px-4 md:px-6',
        // Home stays chromeless so the search is the hero.
        !isHome && 'surface-glass border-b',
      )}
    >
      {!isHome && (
        <button
          type="button"
          data-tour="palette"
          onClick={() => openOmnibox({ toggle: false })}
          className="group hidden h-8 w-72 items-center gap-2 rounded-lg border bg-card/60 px-3 text-[13px] text-muted-foreground transition-[border-color,background-color] duration-150 hover:border-foreground/20 hover:bg-accent md:flex"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <Kbd>{MOD_KEY} K</Kbd>
        </button>
      )}

      <div className="ml-auto flex items-center gap-1">
        {signedIn && <TimerPill />}
        <IconButton
          label="Search"
          shortcut={`${MOD_KEY}K`}
          data-tour="palette"
          onClick={() => openOmnibox({ toggle: false })}
          className={cn(!isHome && 'md:hidden')}
        >
          <Search />
        </IconButton>
        <ThemeToggle />
        {signedIn && <SyncBadge />}
        {signedIn && <NotificationCenter />}
        {!signedIn && !checking && (
          <Button variant="primary" className="ml-1" data-tour="sign-in" onClick={() => setSignInOpen(true)}>
            Sign in
          </Button>
        )}
        {signedIn && (
          <div className="ml-1 md:hidden">
            <ProfileMenu side="bottom" />
          </div>
        )}
      </div>
    </header>
  );
}
