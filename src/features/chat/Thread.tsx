import { ArrowDown, ArrowLeft, Disc3, MoreHorizontal, Trash2, Users } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Avatar,
  AvatarGroup,
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  confirm,
} from '@/components/ui';
import { Composer } from '@/features/chat/Composer';
import { MessageBubble } from '@/features/chat/MessageBubble';
import { buildRows } from '@/features/chat/rows';
import { useChatStore } from '@/features/chat/store';
import type { Conversation, Message } from '@/features/chat/types';
import { generateRoomCode } from '@/features/party/roomCode';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { notify } from '@/lib/toast';
import { sendMessage } from '@/store/demoServer';
import { useNavStore } from '@/store/useNavStore';
import { useUiStore } from '@/store/useUiStore';
import { ME_ID, useUserStore } from '@/store/useUserStore';
import type { Person } from '@/types/user';

const EMPTY: string[] = [];

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Number.POSITIVE_INFINITY, delay: i * 0.15 }}
          className="size-1.5 rounded-full bg-current"
        />
      ))}
    </span>
  );
}

export function Thread({ conversation, onBack }: { conversation: Conversation; onBack?: () => void }) {
  const go = useNavStore((s) => s.go);
  const me = useUserStore((s) => s.currentUser);
  const teammates = useUserStore((s) => s.teammates);
  const allMessages = useChatStore((s) => s.messages);
  const typingIds = useChatStore((s) => s.typing[conversation.id]) ?? EMPTY;
  const markRead = useChatStore((s) => s.markRead);
  const toggleReaction = useChatStore((s) => s.toggleReaction);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const restoreMessage = useChatStore((s) => s.restoreMessage);
  const setReplyingTo = useChatStore((s) => s.setReplyingTo);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const replyingId = useChatStore((s) => s.replyingTo[conversation.id] ?? null);

  const isGroup = conversation.kind === 'group';
  const people = useMemo(() => new Map<string, Person>([[me.id, me], ...teammates.map((t) => [t.id, t] as const)]), [me, teammates]);
  const others = conversation.participantIds.filter((id) => id !== ME_ID).map((id) => people.get(id)).filter((p): p is Person => Boolean(p));
  const peer = !isGroup ? others[0] : undefined;
  const title = isGroup ? (conversation.name ?? 'Group') : (peer?.displayName ?? 'Conversation');

  const msgs = useMemo(() => allMessages.filter((m) => m.conversationId === conversation.id), [allMessages, conversation.id]);
  const rows = useMemo(() => buildRows(msgs, isGroup), [msgs, isGroup]);
  const byId = useMemo(() => new Map(msgs.map((m) => [m.id, m])), [msgs]);

  // ── scrolling ──
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  atBottomRef.current = atBottom;
  const content = useRef<HTMLDivElement>(null);
  const [fresh, setFresh] = useState(0);
  const lastCount = useRef(msgs.length);
  const toBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when switching conversation
  useLayoutEffect(() => {
    toBottom('instant');
    setAtBottom(true);
    setFresh(0);
    lastCount.current = useChatStore.getState().messages.filter((m) => m.conversationId === conversation.id).length;
  }, [conversation.id]);

  useEffect(() => {
    const added = msgs.length - lastCount.current;
    lastCount.current = msgs.length;
    if (added <= 0) return;
    if (atBottom || msgs.at(-1)?.senderId === ME_ID) requestAnimationFrame(() => toBottom('smooth'));
    else setFresh((n) => n + added);
  }, [msgs, atBottom, toBottom]);

  // keep the view pinned when the typing indicator appears
  // biome-ignore lint/correctness/useExhaustiveDependencies: only reacts to typing changes
  useEffect(() => {
    if (atBottom && typingIds.length) requestAnimationFrame(() => toBottom('smooth'));
  }, [typingIds.length]);

  // mark read whenever you're looking at the latest messages
  useEffect(() => {
    if (atBottom && document.visibilityState === 'visible') markRead(conversation.id);
  }, [atBottom, msgs.length, conversation.id, markRead]);

  // Images/videos load after the initial scroll and grow the content — stay pinned if we were at the bottom.
  useEffect(() => {
    const node = content.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => atBottomRef.current && toBottom('instant'));
    ro.observe(node);
    return () => ro.disconnect();
  }, [toBottom]);

  const jumpTo = (id: string) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.animate([{ backgroundColor: 'var(--brand-soft)' }, { backgroundColor: 'transparent' }], { duration: 1400 });
  };

  // ── drag & drop attach ──
  const addFilesRef = useRef<(f: File[]) => void>(() => {});
  const [over, setOver] = useState(false);

  const onReact = (m: Message, emoji: string) => toggleReaction(m.id, emoji, ME_ID);
  const onDelete = (m: Message) => {
    deleteMessage(m.id);
    notify.undo('Message deleted', () => restoreMessage(m.id));
  };
  const onReply = (m: Message) => {
    setReplyingTo(conversation.id, m.id);
  };

  const joinParty = (code: string) => {
    useUiStore.getState().setPartyRoom(code);
    go('party');
  };

  const watchTogether = () => {
    const code = generateRoomCode();
    sendMessage({ conversationId: conversation.id, body: `🍿 Join my VibeParty — room code: ${code}` });
    useUiStore.getState().setPartyRoom(code);
    notify.success('Party room created', 'The code was posted in this chat.');
    go('party');
  };

  const removeConversation = async () => {
    const ok = await confirm({
      title: `Delete ${isGroup ? 'group' : 'conversation'}?`,
      description: 'All messages and attachments in it will be removed from this device.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    deleteConversation(conversation.id);
  };

  const typingNames = typingIds.map((id) => people.get(id)?.displayName.split(' ')[0]).filter(Boolean);
  const subtitle = typingNames.length ? (
    <span className="flex items-center gap-1.5 text-brand-text">
      <TypingDots /> {typingNames.join(', ')} {typingNames.length > 1 ? 'are' : 'is'} typing
    </span>
  ) : isGroup ? (
    `${others.length + 1} members · ${others.filter((o) => o.isOnline).length + 1} online`
  ) : peer?.isOnline ? (
    <span className="flex items-center gap-1.5">
      <span className="size-1.5 rounded-full bg-success" /> online
    </span>
  ) : (
    'offline · they’ll see your messages later'
  );

  const offlineEverywhere = others.length > 0 && others.every((o) => !o.isOnline);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target for file attachments
    <section
      aria-label={`Conversation with ${title}`}
      className="relative flex min-w-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        addFilesRef.current([...e.dataTransfer.files]);
      }}
    >
      {/* header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3 md:px-4">
        {onBack && (
          <IconButton label="Back to chats" size="icon-sm" onClick={onBack} className="md:hidden">
            <ArrowLeft />
          </IconButton>
        )}
        {isGroup ? (
          <span className="grid size-9 place-items-center rounded-full bg-brand-soft text-brand-text">
            <Users className="size-[18px]" />
          </span>
        ) : (
          <Avatar name={title} src={peer?.avatarUrl} size="lg" status={peer?.isOnline ? 'online' : 'offline'} />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold leading-tight tracking-tight">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>

        {isGroup && (
          <Popover>
            <PopoverTrigger render={<IconButton label="Members" />}>
              <AvatarGroup people={[me, ...others].map((p) => ({ id: p.id, name: p.displayName }))} max={3} size="sm" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2">
              <p className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">{others.length + 1} members</p>
              {[me, ...others].map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                  <Avatar name={p.displayName} size="md" status={p.isOnline ? 'online' : 'offline'} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{p.id === ME_ID ? 'You' : p.displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">@{p.username}</p>
                  </div>
                </div>
              ))}
            </PopoverContent>
          </Popover>
        )}
        <IconButton label="Start a watch party (VibeParty)" onClick={watchTogether}>
          <Disc3 />
        </IconButton>
        <DropdownMenu>
          <DropdownTrigger render={<IconButton label="Conversation options" />}>
            <MoreHorizontal />
          </DropdownTrigger>
          <DropdownContent align="end">
            <DropdownItem destructive icon={<Trash2 />} onClick={() => void removeConversation()}>
              Delete conversation
            </DropdownItem>
          </DropdownContent>
        </DropdownMenu>
      </header>

      {/* messages */}
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
          setAtBottom(near);
          if (near) setFresh(0);
        }}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-4 md:px-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        <div ref={content}>
        {rows.length === 0 ? (
          <div className="grid h-full place-items-center">
            <div className="max-w-xs text-center">
              {isGroup ? (
                <span className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand-text">
                  <Users className="size-7" />
                </span>
              ) : (
                <Avatar name={title} size="xl" className="mx-auto mb-3" />
              )}
              <p className="text-sm font-semibold">{isGroup ? `Welcome to ${title}` : `Say hi to ${title.split(' ')[0]} 👋`}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {offlineEverywhere ? 'They’re offline right now, but they’ll see your message later.' : 'Your messages, reactions and images show up here.'}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {['👋 Say hi', '🍿 Watch something?', '🔥 What are you building?'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => sendMessage({ conversationId: conversation.id, body: t.replace(/^\S+\s/, '') })}
                    className="rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          rows.map((row) =>
            row.kind === 'date' ? (
              <div key={row.key} className="sticky top-0 z-[1] my-3 flex justify-center">
                <span className="rounded-full border bg-background/90 px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-xs backdrop-blur">{row.label}</span>
              </div>
            ) : (
              <MessageBubble
                key={row.key}
                message={row.m}
                sender={people.get(row.m.senderId)}
                position={row.position}
                showName={row.showName}
                replyTarget={row.m.replyTo ? byId.get(row.m.replyTo) : undefined}
                replyAuthor={row.m.replyTo ? (byId.get(row.m.replyTo)?.senderId === ME_ID ? 'You' : people.get(byId.get(row.m.replyTo)?.senderId ?? '')?.displayName) : undefined}
                onReply={onReply}
                onReact={onReact}
                onDelete={onDelete}
                onJump={jumpTo}
                onJoinParty={joinParty}
              />
            ),
          )
        )}

        <AnimatePresence>
          {typingIds.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="mt-3 flex items-center gap-2 pl-11 text-muted-foreground"
              aria-live="off"
            >
              <span className="rounded-2xl border bg-muted/70 px-3 py-2.5">
                <TypingDots />
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
      </div>

      {/* jump to latest */}
      <AnimatePresence>
        {!atBottom && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.9 }}
            transition={spring.snappy}
            onClick={() => toBottom('smooth')}
            className={cn(
              'absolute bottom-[8.5rem] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-popover px-3 py-1.5 text-xs font-medium shadow-lg',
              fresh > 0 && 'border-brand/50 bg-brand text-brand-foreground',
            )}
          >
            <ArrowDown className="size-3.5" />
            {fresh > 0 ? `${fresh} new ${fresh === 1 ? 'message' : 'messages'}` : 'Jump to latest'}
          </motion.button>
        )}
      </AnimatePresence>

      <Composer
        conversationId={conversation.id}
        replyAuthor={(() => {
          const sid = replyingId ? byId.get(replyingId)?.senderId : undefined;
          return sid === ME_ID ? 'yourself' : sid ? people.get(sid)?.displayName : undefined;
        })()}
        disabledHint={offlineEverywhere ? `Message ${title.split(' ')[0]} — they’re offline` : undefined}
        registerAddFiles={(fn) => {
          addFilesRef.current = fn;
        }}
      />

      {/* drop overlay */}
      <AnimatePresence>
        {over && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-2 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-brand bg-brand-soft/80 backdrop-blur-sm"
          >
            <p className="text-sm font-medium text-brand-text">Drop to attach · images &amp; video up to 5 MB</p>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
