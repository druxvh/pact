import { ArrowLeft, Hash, MessageCircleMore, Users } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Button, EmptyState, IconButton, Skeleton } from '@/components/ui';
import { Composer } from './Composer';
import { DayDivider, MessageItem, sameDay } from './MessageItem';
import { can } from './permissions';
import type { Community } from './types';
import { getCommunityApi, useCommunityStore } from './useCommunityStore';

const NEAR_BOTTOM = 120;

export function MessagePane({
  community,
  onBack,
  membersOpen,
  onToggleMembers,
}: {
  community: Community;
  onBack?: () => void;
  membersOpen: boolean;
  onToggleMembers: () => void;
}) {
  const channelId = useCommunityStore((s) => s.activeChannelId);
  const channel = useCommunityStore((s) => (s.activeChannelId ? s.channels[community.id]?.find((c) => c.id === s.activeChannelId) : undefined));
  const messages = useCommunityStore((s) => (s.activeChannelId ? s.messages[s.activeChannelId] : undefined));
  const hasMore = useCommunityStore((s) => (s.activeChannelId ? s.hasMore[s.activeChannelId] : false));
  const profiles = useCommunityStore((s) => s.profiles);
  const reactions = useCommunityStore((s) => s.reactions);
  const members = useCommunityStore((s) => s.members[community.id]);
  const loadOlder = useCommunityStore((s) => s.loadOlder);
  const me = getCommunityApi().me;

  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastId = useRef<string | null>(null);
  const height = useRef(0);

  const roleOf = useMemo(() => new Map((members ?? []).map((m) => [m.userId, m.role])), [members]);
  const byId = useMemo(() => new Map((messages ?? []).map((m) => [m.id, m])), [messages]);

  // New channel → start at the bottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the channel is the trigger
  useLayoutEffect(() => {
    stick.current = true;
    lastId.current = null;
  }, [channelId]);

  // Keep the newest message in view if you were already at the bottom; keep your place when older ones load above.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !messages) return;
    const newest = messages.at(-1)?.id ?? null;
    if (stick.current && newest !== lastId.current) el.scrollTop = el.scrollHeight;
    else if (height.current && el.scrollHeight > height.current && newest === lastId.current) el.scrollTop += el.scrollHeight - height.current;
    lastId.current = newest;
    height.current = el.scrollHeight;
  }, [messages]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    height.current = el.scrollHeight;
  }, []);

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('bg-brand-soft');
    window.setTimeout(() => el.classList.remove('bg-brand-soft'), 1400);
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (el) height.current = el.scrollHeight;
  });

  return (
    <section className="flex min-w-0 flex-1 flex-col" aria-label={channel ? `#${channel.name}` : 'Channel'}>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        {onBack && (
          <IconButton label="Back to channels" size="icon-sm" onClick={onBack}>
            <ArrowLeft />
          </IconButton>
        )}
        <Hash className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h2 className="shrink-0 text-sm font-semibold">{channel?.name ?? '…'}</h2>
        {channel?.topic && <p className="hidden min-w-0 truncate border-l pl-2 text-[13px] text-muted-foreground sm:block">{channel.topic}</p>}
        <IconButton
          label={membersOpen ? 'Hide members' : 'Show members'}
          size="icon-sm"
          className="ml-auto"
          onClick={onToggleMembers}
          aria-pressed={membersOpen}
        >
          <Users />
        </IconButton>
      </header>

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto py-2" aria-live="polite" aria-relevant="additions">
        {!messages ? (
          <div className="space-y-4 p-4" role="status" aria-label="Loading messages">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-10" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {hasMore && (
              <div className="flex justify-center py-2">
                <Button variant="ghost" size="sm" onClick={() => void loadOlder()}>
                  Load older messages
                </Button>
              </div>
            )}
            {messages.length === 0 && (
              <EmptyState
                icon={MessageCircleMore}
                title={`Welcome to #${channel?.name ?? 'the channel'}`}
                description="Nothing here yet. Say hello, or share a meme."
                className="mx-auto mt-10 max-w-sm border-0"
              />
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1] ?? null;
              const replied = m.replyTo ? (byId.get(m.replyTo) ?? null) : undefined;
              return (
                <div key={m.id}>
                  {(!prev || !sameDay(prev.createdAt, m.createdAt)) && <DayDivider iso={m.createdAt} />}
                  <MessageItem
                    message={m}
                    previous={prev && sameDay(prev.createdAt, m.createdAt) ? prev : null}
                    replied={replied}
                    author={profiles[m.authorId]}
                    repliedAuthor={replied ? profiles[replied.authorId] : undefined}
                    authorRole={roleOf.get(m.authorId)}
                    reactions={reactions[m.id] ?? []}
                    me={me}
                    myRole={community.role}
                    onJumpTo={jumpTo}
                  />
                </div>
              );
            })}
          </>
        )}
      </div>

      {can(community.role, 'post') && channel && <Composer key={channel.id} communityId={community.id} channelName={channel.name} />}
    </section>
  );
}
