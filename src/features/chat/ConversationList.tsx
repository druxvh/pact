import { MessageCirclePlus, Search, UserPlus, Users, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo } from 'react';
import { Avatar, Badge, IconButton, InputGroup } from '@/components/ui';
import { lastMessageOf, unreadCount, useChatStore } from '@/features/chat/store';
import type { Conversation, Message } from '@/features/chat/types';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { spring } from '@/lib/motion';
import { ME_ID, useUserStore } from '@/store/useUserStore';
import type { Person } from '@/types/user';

function previewOf(m: Message | undefined, conv: Conversation, people: Map<string, Person>): string {
  if (!m) return 'No messages yet';
  const body = m.body.trim() || (m.attachments?.[0]?.kind === 'video' ? '🎬 Video' : m.attachments?.length ? '📷 Photo' : '');
  if (m.senderId === ME_ID) return `You: ${body}`;
  if (conv.kind === 'group') return `${people.get(m.senderId)?.displayName.split(' ')[0] ?? 'Someone'}: ${body}`;
  return body;
}

export function ConversationList({
  activeId,
  onSelect,
  onNewGroup,
  onFriends,
  pendingRequests,
}: {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewGroup: () => void;
  onFriends: () => void;
  pendingRequests: number;
}) {
  const conversations = useChatStore((s) => s.conversations);
  const messages = useChatStore((s) => s.messages);
  const typing = useChatStore((s) => s.typing);
  const search = useChatStore((s) => s.search);
  const setSearch = useChatStore((s) => s.setSearch);
  const me = useUserStore((s) => s.currentUser);
  const teammates = useUserStore((s) => s.teammates);

  const people = useMemo(() => new Map<string, Person>([[me.id, me], ...teammates.map((t) => [t.id, t] as const)]), [me, teammates]);

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations
      .map((c) => {
        const peer = c.kind === 'dm' ? people.get(c.participantIds.find((id) => id !== ME_ID) ?? '') : undefined;
        const title = c.kind === 'group' ? (c.name ?? 'Group') : (peer?.displayName ?? 'Conversation');
        return { c, peer, title, last: lastMessageOf(messages, c.id) };
      })
      .filter(({ title, last }) => !q || title.toLowerCase().includes(q) || last?.body.toLowerCase().includes(q))
      .sort((a, b) => b.c.lastMessageAt.localeCompare(a.c.lastMessageAt));
  }, [conversations, messages, people, search]);

  return (
    <aside aria-label="Conversations" className="flex w-full shrink-0 flex-col border-r md:w-[320px]">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <h2 className="flex-1 pl-1 text-base font-semibold tracking-tight">Chats</h2>
        <IconButton label="New group" onClick={onNewGroup}>
          <MessageCirclePlus />
        </IconButton>
        <span className="relative">
          <IconButton label={pendingRequests ? `Friends (${pendingRequests} request${pendingRequests > 1 ? 's' : ''})` : 'Friends'} onClick={onFriends}>
            <UserPlus />
          </IconButton>
          {pendingRequests > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={spring.bouncy}
              className="pointer-events-none absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold leading-4 text-brand-foreground ring-2 ring-background"
            >
              {pendingRequests}
            </motion.span>
          )}
        </span>
      </div>

      <div className="px-3 pb-2">
        <InputGroup
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leading={<Search />}
          trailing={
            search ? (
              <button type="button" aria-label="Clear search" onClick={() => setSearch('')} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent">
                <X className="size-3.5" />
              </button>
            ) : undefined
          }
          placeholder="Search chats and messages…"
          aria-label="Search chats"
          inputClassName="h-8 text-[13px]"
        />
      </div>

      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2">
        <AnimatePresence initial={false}>
          {items.map(({ c, peer, title, last }) => {
            const unread = unreadCount(c, messages);
            const active = c.id === activeId;
            const typers = typing[c.id] ?? [];
            return (
              <motion.li key={c.id} layout="position" transition={spring.soft} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-offset-[-2px] transition-colors duration-150 active:scale-[0.99]',
                    active ? 'bg-brand-soft' : 'hover:bg-accent',
                  )}
                >
                  {active && <span className="absolute left-0 top-3 h-[calc(100%-1.5rem)] w-[3px] rounded-r-full bg-brand" />}
                  {c.kind === 'group' ? (
                    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                      <Users className="size-5" />
                    </span>
                  ) : (
                    <Avatar name={title} src={peer?.avatarUrl} size="lg" status={peer?.isOnline ? 'online' : 'offline'} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn('truncate text-[13.5px]', unread ? 'font-semibold' : 'font-medium')}>{title}</span>
                      <span className={cn('shrink-0 text-[11px]', unread ? 'font-medium text-brand-text' : 'text-subtle-foreground')}>
                        {last ? relativeTime(last.createdAt) : ''}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn('truncate text-xs', typers.length ? 'text-brand-text' : unread ? 'text-foreground' : 'text-muted-foreground')}>
                        {typers.length ? 'typing…' : previewOf(last, c, people)}
                      </span>
                      {unread > 0 && !active && <Badge tone="brand" className="h-[18px] min-w-[18px] justify-center rounded-full bg-brand px-1.5 text-brand-foreground">{unread > 99 ? '99+' : unread}</Badge>}
                    </span>
                  </span>
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
        {items.length === 0 && (
          <li className="px-4 py-10 text-center text-[13px] text-muted-foreground">
            {search ? `No chats match “${search}”` : 'No conversations yet — add a friend to start one.'}
          </li>
        )}
      </ul>
    </aside>
  );
}
