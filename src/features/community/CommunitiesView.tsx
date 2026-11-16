import { Plus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, EmptyState, IconButton, Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useNavStore } from '@/store/useNavStore';
import { ChannelPanel } from './ChannelPanel';
import { CommunityIcon } from './CommunityIcon';
import { CreateOrJoinDialog, InviteDialog, SettingsDialog } from './Dialogs';
import { MembersPanel } from './MembersPanel';
import { MessagePane } from './MessagePane';
import { useCommunityStore } from './useCommunityStore';

/** Invite deep links look like `#/chat/join:<code>`. */
export const inviteCodeFromSub = (sub: string | null) => (sub?.startsWith('join:') ? sub.slice(5) : null);

export function CommunitiesView() {
  const ready = useCommunityStore((s) => s.ready);
  const error = useCommunityStore((s) => s.error);
  const communities = useCommunityStore((s) => s.communities);
  const activeId = useCommunityStore((s) => s.activeId);
  const select = useCommunityStore((s) => s.select);
  const sub = useNavStore((s) => s.sub);
  const go = useNavStore((s) => s.go);
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const wide = useMediaQuery('(min-width: 1024px)');

  const [joinOpen, setJoinOpen] = useState(false);
  const [initialCode, setInitialCode] = useState<string | undefined>();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(true);
  const [mobileChannel, setMobileChannel] = useState(false);

  useEffect(() => {
    void useCommunityStore.getState().init();
    return () => useCommunityStore.getState().dispose();
  }, []);

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
        {communities.map((c) => (
          <Tooltip key={c.id} content={c.name} side="right">
            <button
              type="button"
              aria-label={c.name}
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
            </button>
          </Tooltip>
        ))}
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
          {membersOpen && wide && <MembersPanel community={active} />}
        </>
      )}
      {dialogs}
    </div>
  );
}
