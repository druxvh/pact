import { ChevronDown, Hash, LogOut, Settings, UserPlus } from 'lucide-react';
import { Button, confirm, DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { describeError } from './mapping';
import { can } from './permissions';
import type { Community } from './types';
import { getCommunityApi, useCommunityStore } from './useCommunityStore';

export function ChannelPanel({
  community,
  onOpenChannel,
  onInvite,
  onSettings,
}: {
  community: Community;
  onOpenChannel: () => void;
  onInvite: () => void;
  onSettings: () => void;
}) {
  const channels = useCommunityStore((s) => s.channels[community.id]) ?? [];
  const activeChannelId = useCommunityStore((s) => s.activeChannelId);
  const selectChannel = useCommunityStore((s) => s.selectChannel);

  const leave = async () => {
    if (
      !(await confirm({ title: `Leave ${community.name}?`, description: 'You’ll need a new invite to come back.', confirmLabel: 'Leave', destructive: true }))
    )
      return;
    try {
      await getCommunityApi().leaveCommunity(community.id);
      await useCommunityStore.getState().refreshCommunities();
      await useCommunityStore.getState().select(useCommunityStore.getState().communities[0]?.id ?? null);
    } catch (err) {
      notify.error('Couldn’t leave', describeError(err));
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col md:w-56 md:flex-none md:shrink-0 md:border-r">
      <DropdownMenu>
        <DropdownTrigger className="flex h-12 w-full shrink-0 items-center gap-2 border-b px-3 text-left outline-offset-[-2px] transition-colors hover:bg-accent/50">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{community.name}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </DropdownTrigger>
        <DropdownContent align="start" className="w-56">
          {can(community.role, 'createInvite') && (
            <DropdownItem icon={<UserPlus />} onClick={onInvite}>
              Invite people
            </DropdownItem>
          )}
          {can(community.role, 'editCommunity') && (
            <DropdownItem icon={<Settings />} onClick={onSettings}>
              Community settings
            </DropdownItem>
          )}
          {community.role !== 'admin' && (
            <>
              {can(community.role, 'createInvite') && <DropdownSeparator />}
              <DropdownItem icon={<LogOut />} destructive onClick={() => void leave()}>
                Leave community
              </DropdownItem>
            </>
          )}
        </DropdownContent>
      </DropdownMenu>

      {community.description && <p className="border-b px-3 py-2 text-xs leading-snug text-muted-foreground">{community.description}</p>}

      <nav aria-label="Channels" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">Channels</p>
        {channels.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-current={c.id === activeChannelId ? 'true' : undefined}
            onClick={() => {
              void selectChannel(c.id);
              onOpenChannel();
            }}
            className={cn(
              'flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-sm transition-colors',
              c.id === activeChannelId ? 'bg-brand-soft font-medium text-brand-text' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Hash className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{c.name}</span>
          </button>
        ))}
        {can(community.role, 'createChannel') && (
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start text-muted-foreground" onClick={onSettings}>
            + Add a channel
          </Button>
        )}
      </nav>
    </div>
  );
}
