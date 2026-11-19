import { Keyboard, LogIn, LogOut, Monitor, Moon, Settings, StickyNote, Sun } from 'lucide-react';
import { Avatar, DropdownContent, DropdownItem, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger, IconButton, Tooltip } from '@/components/ui';
import { useActivityStore } from '@/features/activity/hooks';
import { openNoteComposer } from '@/features/activity/ui';
import { requestSignOut } from '@/lib/supabase/signOut';
import { selectSignedIn, useAuthStore } from '@/store/useAuthStore';
import { useNavStore } from '@/store/useNavStore';
import { type ThemeMode, useThemeStore } from '@/store/useThemeStore';
import { useUiStore } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';

const THEMES: Array<{ mode: ThemeMode; label: string; icon: React.ReactNode }> = [
  { mode: 'light', label: 'Light', icon: <Sun /> },
  { mode: 'dark', label: 'Dark', icon: <Moon /> },
  { mode: 'system', label: 'System', icon: <Monitor /> },
];

export function ProfileMenu({ side = 'right' }: { side?: 'top' | 'right' | 'bottom' | 'left' }) {
  const me = useUserStore((s) => s.currentUser);
  const go = useNavStore((s) => s.go);
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const setSignInOpen = useUiStore((s) => s.setSignInOpen);
  const signedIn = useAuthStore(selectSignedIn);
  const email = useAuthStore((s) => s.user?.email ?? null);
  const hasNote = useActivityStore((s) => s.mine.note !== null);

  // Guests have no account menu — just a way in.
  if (!signedIn) {
    return (
      <Tooltip content="Sign in" side={side === 'right' ? 'right' : 'bottom'}>
        <IconButton label="Sign in" tooltip={false} onClick={() => setSignInOpen(true)}>
          <LogIn />
        </IconButton>
      </Tooltip>
    );
  }

  return (
    <DropdownMenu>
      <Tooltip content={me.displayName} side={side === 'right' ? 'right' : 'bottom'}>
        <DropdownTrigger aria-label="Account menu" className="rounded-lg outline-offset-2 transition-transform duration-150 hover:scale-105 active:scale-95">
          <Avatar name={me.displayName} src={me.avatarUrl} size="md" status={me.isOnline ? 'online' : undefined} />
        </DropdownTrigger>
      </Tooltip>
      <DropdownContent side={side} align={side === 'right' ? 'end' : 'end'} sideOffset={10} className="w-60">
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar name={me.displayName} src={me.avatarUrl} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{me.displayName}</p>
            <p className="truncate text-xs text-muted-foreground">@{me.username}</p>
            {email && <p className="truncate text-xs text-subtle-foreground">{email}</p>}
          </div>
        </div>
        <DropdownSeparator />
        <DropdownItem icon={<StickyNote />} onClick={openNoteComposer}>
          {hasNote ? 'Edit your note' : 'Add a note'}
        </DropdownItem>
        <DropdownItem icon={<Settings />} onClick={() => go('settings')}>
          Profile &amp; settings
        </DropdownItem>
        <DropdownItem icon={<Keyboard />} shortcut="?" onClick={() => setShortcutsOpen(true)}>
          Keyboard shortcuts
        </DropdownItem>
        <DropdownSeparator />
        <DropdownLabel>Theme</DropdownLabel>
        {THEMES.map((t) => (
          <DropdownItem
            key={t.mode}
            icon={t.icon}
            closeOnClick={false}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMode(t.mode, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
            }}
            shortcut={mode === t.mode ? '●' : undefined}
          >
            {t.label}
          </DropdownItem>
        ))}
        <DropdownSeparator />
        <DropdownItem icon={<LogOut />} onClick={() => void requestSignOut()}>
          Sign out
        </DropdownItem>
      </DropdownContent>
    </DropdownMenu>
  );
}
