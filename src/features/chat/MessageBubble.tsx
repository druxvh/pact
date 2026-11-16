import { Copy, CornerUpLeft, Disc3, Smile, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Avatar, IconButton, Popover, PopoverContent, PopoverTrigger } from '@/components/ui';
import { AttachmentView } from '@/features/chat/AttachmentView';
import { EmojiPicker } from '@/features/chat/EmojiPicker';
import { QUICK_REACTIONS } from '@/features/chat/emoji-data';
import { Linkified } from '@/features/chat/Linkified';
import type { RunPosition } from '@/features/chat/rows';
import type { Message } from '@/features/chat/types';
import { findRoomCode } from '@/features/party/roomCode';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { ME_ID } from '@/store/useUserStore';
import type { Person } from '@/types/user';

type Props = {
  message: Message;
  sender?: Person;
  position: RunPosition;
  showName: boolean;
  replyTarget?: Message;
  replyAuthor?: string;
  onReply: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  onDelete: (m: Message) => void;
  onJump: (id: string) => void;
  onJoinParty: (code: string) => void;
};

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function MessageBubble({ message: m, sender, position, showName, replyTarget, replyAuthor, onReply, onReact, onDelete, onJump, onJoinParty }: Props) {
  const mine = m.senderId === ME_ID;
  const [pickerOpen, setPickerOpen] = useState(false);
  const joinedAbove = position === 'middle' || position === 'last';
  const joinedBelow = position === 'first' || position === 'middle';
  const showAvatar = !mine && (position === 'last' || position === 'single');

  if (m.deleted) {
    return (
      <div className={cn('flex px-1', mine ? 'justify-end' : 'justify-start pl-10')}>
        <p className="rounded-lg border border-dashed px-3 py-1.5 text-xs italic text-subtle-foreground">Message deleted</p>
      </div>
    );
  }

  const hasText = m.body.trim().length > 0;
  const partyCode = findRoomCode(m.body);
  const emojiOnly = hasText && !m.attachments?.length && /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\s){1,6}$/u.test(m.body.trim());

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring.soft}
      data-message-id={m.id}
      className={cn('group/msg relative flex items-end gap-2 px-1', mine ? 'justify-end' : 'justify-start', joinedAbove ? 'mt-0.5' : 'mt-3')}
    >
      {!mine && <span className="w-8 shrink-0">{showAvatar && sender && <Avatar name={sender.displayName} src={sender.avatarUrl} size="md" />}</span>}

      <div className={cn('flex max-w-[min(34rem,78%)] flex-col', mine ? 'items-end' : 'items-start')}>
        {showName && sender && <span className="mb-0.5 ml-1 text-[11px] font-medium text-muted-foreground">{sender.displayName}</span>}

        <div className="relative">
          {/* hover actions */}
          <div
            className={cn(
              'absolute -top-4 z-10 flex items-center gap-0.5 rounded-lg border bg-popover p-0.5 opacity-0 shadow-md transition-opacity duration-150',
              'group-focus-within/msg:opacity-100 group-hover/msg:opacity-100 data-[open=true]:opacity-100',
              mine ? 'right-1' : 'left-1',
            )}
            data-open={pickerOpen}
          >
            {QUICK_REACTIONS.slice(0, 3).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => onReact(m, e)}
                aria-label={`React ${e}`}
                className="grid size-7 place-items-center rounded-lg text-sm transition-transform hover:scale-125 hover:bg-accent"
              >
                {e}
              </button>
            ))}
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger render={<IconButton label="More reactions" size="icon-sm" tooltip={false} />}>
                <Smile />
              </PopoverTrigger>
              <PopoverContent align={mine ? 'end' : 'start'} className="p-0">
                <EmojiPicker
                  onPick={(e) => {
                    onReact(m, e);
                    setPickerOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
            <IconButton label="Reply" size="icon-sm" tooltip={false} onClick={() => onReply(m)}>
              <CornerUpLeft />
            </IconButton>
            {hasText && (
              <IconButton label="Copy text" size="icon-sm" tooltip={false} onClick={() => void copyText(m.body, 'Message copied')}>
                <Copy />
              </IconButton>
            )}
            {mine && (
              <IconButton label="Delete message" variant="danger" size="icon-sm" tooltip={false} onClick={() => onDelete(m)}>
                <Trash2 />
              </IconButton>
            )}
          </div>

          <div
            className={cn(
              'overflow-hidden text-[14px] leading-relaxed',
              emojiOnly ? 'bg-transparent text-4xl leading-none' : 'rounded-lg px-3 py-2',
              !emojiOnly && (mine ? 'bg-brand text-brand-foreground' : 'border bg-muted/70 text-foreground'),
              !emojiOnly && mine && [joinedAbove && 'rounded-tr-sm', joinedBelow && 'rounded-br-sm'],
              !emojiOnly && !mine && [joinedAbove && 'rounded-tl-sm', joinedBelow && 'rounded-bl-sm'],
              m.attachments?.length && !hasText && 'bg-transparent p-0',
            )}
          >
            {replyTarget && (
              <button
                type="button"
                onClick={() => onJump(replyTarget.id)}
                className={cn(
                  'mb-1.5 block w-full rounded-lg border-l-2 px-2 py-1 text-left text-xs transition-colors',
                  mine ? 'border-brand-foreground/60 bg-brand-foreground/10 hover:bg-brand-foreground/15' : 'border-brand bg-background/60 hover:bg-background',
                )}
              >
                <span className="block font-medium opacity-80">{replyAuthor}</span>
                <span className="line-clamp-1 opacity-80">{replyTarget.deleted ? 'Message deleted' : replyTarget.body || 'Attachment'}</span>
              </button>
            )}
            {m.attachments?.length ? (
              <div className={cn('flex flex-col gap-1.5', hasText && 'mb-1.5')}>
                {m.attachments.map((a) => (
                  <AttachmentView key={a.id} attachment={a} />
                ))}
              </div>
            ) : null}
            {hasText && (
              <p className="whitespace-pre-wrap break-words">
                <Linkified text={m.body} />
              </p>
            )}
            {partyCode && (
              <button
                type="button"
                onClick={() => onJoinParty(partyCode)}
                className={cn(
                  'mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-[filter,transform] active:scale-[0.97]',
                  mine ? 'bg-brand-foreground text-brand hover:brightness-125' : 'bg-brand text-brand-foreground hover:brightness-110',
                )}
              >
                <Disc3 className="size-3.5" /> Join the party
              </button>
            )}
          </div>
        </div>

        {m.reactions && m.reactions.length > 0 && (
          <div className="-mt-1 flex flex-wrap gap-1 px-1">
            <AnimatePresence initial={false}>
              {m.reactions.map((r) => {
                const reacted = r.by.includes(ME_ID);
                return (
                  <motion.button
                    key={r.emoji}
                    layout
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.4, opacity: 0 }}
                    transition={spring.bouncy}
                    type="button"
                    onClick={() => onReact(m, r.emoji)}
                    aria-label={`${r.emoji} ${r.by.length} ${reacted ? '(you reacted)' : ''}`}
                    aria-pressed={reacted}
                    className={cn(
                      'flex h-6 items-center gap-1 rounded-lg border bg-card px-1.5 text-xs shadow-xs transition-colors',
                      reacted ? 'border-brand/50 bg-brand-soft text-brand-text' : 'hover:bg-accent',
                    )}
                  >
                    <span className="text-[13px]">{r.emoji}</span>
                    {r.by.length > 1 && <span className="tabular font-medium">{r.by.length}</span>}
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {(position === 'last' || position === 'single') && <span className="mt-1 px-1 text-[10px] text-subtle-foreground">{time(m.createdAt)}</span>}
      </div>
    </motion.div>
  );
}
