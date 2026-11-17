import { BellOff, Plus, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, EmptyState, IconButton, Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useNavStore } from '@/store/useNavStore';
import { ChannelPanel } from './ChannelPanel';
import { CommunityIcon } from './CommunityIcon';
import { CreateOrJoinDialog, InviteDialog, SettingsDialog } from './Dialogs';
import { MembersPanel } from './MembersPanel';
import { MessagePane } from './MessagePane';
import { communityLinkFromSub } from './notifications';
import { isMuted, useCommunityPrefs } from './prefs';
import { ModerationDialog, type ModerationTab } from './SafetyDialogs';
import { communityUnread } from './store';
import { useCommunityStore } from './useCommunityStore';

/** Invite deep links look like `#/chat/join:<code>`. */
export const inviteCodeFromSub = (sub: string | null) => (sub?.startsWith('join:') ? sub.slice(5) : null);

export function CommunitiesView() {
  const ready = useCommunityStore((s) => s.ready);
  const error = useCommunityStore((s) => s.error);
  const communities = useCommunityStore((s) => s.communities);
  const activeId = useCommunityStore((s) => s.activeId);
  const select = useCommunityStore((s) => s.select);
  const unread = useCommunityStore((s) => s.unread);
  const muted = useCommunityPrefs((s) => s.muted);
  const sub = useNavStore((s) => s.sub);
  const go = useNavStore((s) => s.go);
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const wide = useMediaQuery('(min-width: 1024px)');

  const [joinOpen, setJoinOpen] = useState(false);
  const [initialCode, setInitialCode] = useState<string | undefined>();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moderation, setModeration] = useState<{ open: boolean; tab: ModerationTab }>({ open: false, tab: 'slowmode' });
  const [membersOpen, setMembersOpen] = useState(true);
  const [mobileChannel, setMobileChannel] = useState(false);

  // A notification link (`#/chat/c:<community>:<channel>`) opens that channel — once the view has loaded, whether it was
  // already open or is opening because of the link.
  const openLink = useCallback(async () => {
    const link = communityLinkFromSub(useNavStore.getState().sub);
    if (!link) return;
    go('chat', null, { replace: true });
    const store = useCommunityStore.getState();
    if (!store.communities.some((c) => c.id === link.communityId)) await store.refreshCommunities();
    if (!useCommunityStore.getState().communities.some((c) => c.id === link.communityId)) return; // no longer a member
    if (useCommunityStore.getState().activeId !== link.communityId) await useCommunityStore.getState().select(link.communityId);
    if (useCommunityStore.getState().channels[link.communityId]?.some((c) => c.id === link.channelId))
      await useCommunityStore.getState().selectChannel(link.channelId);
    setMobileChannel(true);
  }, [go]);
  useEffect(() => {
    void useCommunityStore
      .getState()
      .init()
      .then(() => openLink());
    return () => useCommunityStore.getState().dispose();
  }, [openLink]);

  // (declared after the load effect, so while that is still loading `loading` is already true and it takes care of the link)
  useEffect(() => {
    const st = useCommunityStore.getState();
    if (communityLinkFromSub(sub) && st.ready && !st.loading) void openLink();
  }, [sub, openLink]);

  // An invite link opens the join box with the code filled in.
  useEffect(() => {
    const code = inviteCodeFromSub(sub);
    if (!code) return;
    setInitialCode(code);
    setJoinOpen(true);
    go('chat', null, { replace: true });
  }, [sub, go]);

  const active = communities.find((c) => c.id === activeId) ?? null;

  if (!ready && !error) {
    return (
      <div className="grid min-w-0 flex-1 place-items-center" role="status" aria-label="Loading communities">
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    );
  }

  const dialogs = (
    <>
      <CreateOrJoinDialog open={joinOpen} onOpenChange={setJoinOpen} initialCode={initialCode} />
      {active && <InviteDialog community={active} open={inviteOpen} onOpenChange={setInviteOpen} />}
      {active && <SettingsDialog community={active} open={settingsOpen} onOpenChange={setSettingsOpen} />}
      {active && (
        <ModerationDialog
          community={active}
          tab={moderation.tab}
          onTabChange={(tab) => setModeration((m) => ({ ...m, tab }))}
          open={moderation.open}
          onOpenChange={(open) => setModeration((m) => ({ ...m, open }))}
        />
      )}
    </>
  );

  if (communities.length === 0) {
    return (
      <div className="grid min-w-0 flex-1 place-items-center p-6">
        <EmptyState
          icon={Users}
          title="Find your people"
          description={
            error ??
            'Communities are private groups you join with an invite — share memes, GIFs and links, reply to each other, and keep it friendly with moderators.'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => setJoinOpen(true)}>
                Join with an invite
              </Button>
              <Button variant="outline" onClick={() => setJoinOpen(true)}>
                Create a community
              </Button>
            </div>
          }
          className="max-w-md border-0"
        />
        {dialogs}
      </div>
    );
  }

  const showPane = isDesktop || mobileChannel;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <nav
        aria-label="Communities"
        className={cn(
          'flex shrink-0 flex-col items-center gap-2 overflow-y-auto border-r bg-background/50 p-2',
          isDesktop ? 'w-16' : mobileChannel ? 'hidden' : 'w-16',
        )}
      >
        {communities.map((c) => {
          const silenced = isMuted(muted, c.id);
          const n = c.id === activeId || silenced ? 0 : communityUnread(unread, c.id);
          return (
            <Tooltip key={c.id} content={c.name} side="right">
              <button
                type="button"
                aria-label={`${c.name}${silenced ? ', muted' : ''}${n > 0 ? `, ${n > 99 ? '99+' : n} unread` : ''}`}
                aria-current={c.id === activeId ? 'true' : undefined}
                onClick={() => {
                  void select(c.id);
                  setMobileChannel(false);
                }}
                className={cn(
                  'relative rounded-lg outline-offset-2 transition-transform duration-150 hover:scale-105 active:scale-95',
                  c.id === activeId && 'ring-2 ring-brand ring-offset-2 ring-offset-background',
                )}
              >
                <CommunityIcon name={c.name} hue={c.hue} />
                {silenced && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full bg-background text-muted-foreground ring-1 ring-border"
                  >
                    <BellOff className="size-2.5" />
                  </span>
                )}
                {n > 0 && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold leading-4 text-brand-foreground ring-2 ring-background"
                  >
                    {n > 99 ? '99+' : n}
                  </span>
                )}
              </button>
            </Tooltip>
          );
        })}
        <Tooltip content="Join or create a community" side="right">
          <IconButton label="Join or create a community" size="icon-lg" variant="outline" onClick={() => setJoinOpen(true)}>
            <Plus />
          </IconButton>
        </Tooltip>
      </nav>

      {active && (isDesktop || !mobileChannel) && (
        <ChannelPanel
          community={active}
          onOpenChannel={() => setMobileChannel(true)}
          onInvite={() => setInviteOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onModeration={() => setModeration({ open: true, tab: 'slowmode' })}
        />
      )}
      {active && showPane && (
        <>
          <MessagePane
            community={active}
            onBack={isDesktop ? undefined : () => setMobileChannel(false)}
            membersOpen={membersOpen && wide}
            onToggleMembers={() => setMembersOpen((v) => !v)}
          />
          {membersOpen && wide && <MembersPanel community={active} onShowBans={() => setModeration({ open: true, tab: 'bans' })} />}
        </>
      )}
      {dialogs}
    </div>
  );
}
