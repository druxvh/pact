import { Bell, BellOff, ChevronDown, Hash, LogOut, Settings, ShieldAlert, Timer, UserPlus } from 'lucide-react';
import { Badge, Button, confirm, DropdownContent, DropdownItem, DropdownMenu, DropdownSeparator, DropdownTrigger } from '@/components/ui';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { describeError, toCommunityError } from './mapping';
import { can } from './permissions';
import { isMuted, useCommunityPrefs } from './prefs';
import { formatUntil, slowmodeLabel } from './safety';
import type { Community } from './types';
import { getCommunityApi, setCommunityMuted, useCommunityStore } from './useCommunityStore';

export function ChannelPanel({
  community,
  onOpenChannel,
  onInvite,
  onSettings,
  onModeration,
}: {
  community: Community;
  onOpenChannel: () => void;
  onInvite: () => void;
  onSettings: () => void;
  onModeration: () => void;
}) {
  const channels = useCommunityStore((s) => s.channels[community.id]) ?? [];
  const activeChannelId = useCommunityStore((s) => s.activeChannelId);
  const unread = useCommunityStore((s) => s.unread);
  const selectChannel = useCommunityStore((s) => s.selectChannel);
  const muted = useCommunityPrefs((s) => isMuted(s.muted, community.id));

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
      const e = toCommunityError(err);
      notify.error(
        'Couldn’t leave',
        e.code === 'timed_out' && e.detail?.until ? `You can leave once your timeout ends (${formatUntil(e.detail.until)}).` : describeError(err),
      );
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col md:w-56 md:flex-none md:shrink-0 md:border-r">
      <DropdownMenu>
        <DropdownTrigger className="flex h-12 w-full shrink-0 items-center gap-2 border-b px-3 text-left outline-offset-[-2px] transition-colors hover:bg-accent/50">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{community.name}</span>
          {muted && <BellOff className="size-3.5 shrink-0 text-muted-foreground" aria-label="Notifications muted" />}
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </DropdownTrigger>
        <DropdownContent align="start" className="w-56">
          {can(community.role, 'createInvite') && (
            <DropdownItem icon={<UserPlus />} onClick={onInvite}>
              Invite people
            </DropdownItem>
          )}
          {can(community.role, 'setSlowmode') && (
            <DropdownItem icon={<ShieldAlert />} onClick={onModeration}>
              Moderation
            </DropdownItem>
          )}
          {can(community.role, 'editCommunity') && (
            <DropdownItem icon={<Settings />} onClick={onSettings}>
              Community settings
            </DropdownItem>
          )}
          <DropdownItem icon={muted ? <Bell /> : <BellOff />} onClick={() => setCommunityMuted(community.id, !muted)}>
            {muted ? 'Unmute notifications' : 'Mute notifications'}
          </DropdownItem>
          {community.role !== 'admin' && (
            <>
              <DropdownSeparator />
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
        {channels.map((c) => {
          const n = c.id === activeChannelId || muted ? 0 : (unread[c.id]?.count ?? 0);
          return (
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
                c.id === activeChannelId
                  ? 'bg-brand-soft font-medium text-brand-text'
                  : n > 0
                    ? 'font-semibold text-foreground hover:bg-accent'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Hash className="size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.slowmodeSeconds > 0 && (
                <span title={`Slowmode: ${slowmodeLabel(c.slowmodeSeconds)}`} className="shrink-0 text-subtle-foreground">
                  <Timer className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">Slowmode {slowmodeLabel(c.slowmodeSeconds)}</span>
                </span>
              )}
              {n > 0 && (
                <Badge tone="brand" className="h-[18px] min-w-[18px] justify-center rounded-full bg-brand px-1.5 text-brand-foreground">
                  {n > 99 ? '99+' : n}
                  <span className="sr-only"> unread</span>
                </Badge>
              )}
            </button>
          );
        })}
        {can(community.role, 'createChannel') && (
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start text-muted-foreground" onClick={onSettings}>
            + Add a channel
          </Button>
        )}
      </nav>
    </div>
  );
}
