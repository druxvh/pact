import { CornerUpLeft, Eye, EyeOff, Link2Off, MoreHorizontal, Pencil, SmilePlus, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  promptText,
  Textarea,
} from '@/components/ui';
import { Linkified } from '@/features/chat/Linkified';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { AttachmentView } from './AttachmentView';
import { LinkPreviewCard } from './LinkPreviewCard';
import { extractUrls, gifUrl, snippet } from './links';
import { describeError } from './mapping';
import { can, roleLabel } from './permissions';
import type { CommunityMessage, Profile, Reaction, Role } from './types';
import { getCommunityApi, useCommunityStore } from './useCommunityStore';

const QUICK = ['👍', '❤️', '😂', '🔥', '🎉', '👀', '😮', '🙏'];

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

export const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();

export function DayDivider({ iso }: { iso: string }) {
  return (
    <div className="my-3 flex items-center gap-3 text-[11px] font-medium text-subtle-foreground">
      <span className="h-px flex-1 bg-border" />
      {day(iso)}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

type Props = {
  message: CommunityMessage;
  /** The message above it, to decide whether to show the author again. */
  previous: CommunityMessage | null;
  /** `undefined` = not a reply; `null` = a reply to a message that isn't loaded. */
  replied: CommunityMessage | null | undefined;
  author: Profile | undefined;
  repliedAuthor: Profile | undefined;
  authorRole: Role | undefined;
  reactions: Reaction[];
  me: string;
  myRole: Role;
  onJumpTo: (id: string) => void;
};

/** A GIF shared from the picker: the picture itself, with the edited marker kept off it. Falls back to the link if it won't load. */
function GifImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <p className="text-sm">
        <Linkified text={url} />
      </p>
    );
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="mt-1 block max-h-64 max-w-[min(100%,20rem)] rounded-lg bg-muted"
    />
  );
}

export function MessageItem({ message: m, previous, replied, author, repliedAuthor, authorRole, reactions, me, myRole, onJumpTo }: Props) {
  const store = useCommunityStore;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const [original, setOriginal] = useState<{ body: string } | null>(null);
  const [picker, setPicker] = useState(false);

  const mine = m.authorId === me;
  const moderator = can(myRole, 'moderateMessages');
  const tomb = m.deletedAt !== null;
  const hidden = m.hiddenAt !== null;
  const intact = !tomb && !hidden;
  const name = author?.displayName || author?.username || 'Someone';
  const grouped =
    !!previous &&
    previous.authorId === m.authorId &&
    !m.replyTo &&
    sameDay(previous.createdAt, m.createdAt) &&
    Date.parse(m.createdAt) - Date.parse(previous.createdAt) < 5 * 60_000 &&
    previous.deletedAt === null;
  const gif = intact && !m.linksRemovedAt ? gifUrl(m.body) : null;
  const urls = intact && !m.linksRemovedAt && !gif ? extractUrls(m.body, 2) : [];

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      notify.error('That didn’t work', describeError(err));
    }
  };

  const grouping = (() => {
    const counts = new Map<string, { n: number; mine: boolean }>();
    for (const r of reactions) {
      const c = counts.get(r.emoji) ?? { n: 0, mine: false };
      counts.set(r.emoji, { n: c.n + 1, mine: c.mine || r.userId === me });
    }
    return [...counts.entries()];
  })();

  const hide = async () => {
    const reason = await promptText({
      title: 'Hide this message?',
      description: 'Members will see that a moderator hid it. You and other moderators can still read and restore it.',
      label: 'Reason (optional)',
      maxLength: 200,
      confirmLabel: 'Hide message',
    });
    if (reason !== null) await run(() => store.getState().hide(m.id, reason));
  };

  const showOriginal = async () => {
    if (original) return setOriginal(null);
    await run(async () => setOriginal(await getCommunityApi().getOriginal(m.id)));
  };

  const body = (() => {
    if (tomb) return <p className="text-[13px] italic text-subtle-foreground">This message was deleted.</p>;
    if (hidden) {
      return (
        <div className="rounded-lg border border-dashed px-3 py-2 text-[13px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <EyeOff className="size-3.5" aria-hidden="true" /> A moderator hid this message{m.hiddenReason ? ` — “${m.hiddenReason}”` : ''}.
          </span>
          {moderator && (
            <span className="ml-3 inline-flex gap-1">
              <Button variant="ghost" size="xs" onClick={() => void showOriginal()}>
                <Eye /> {original ? 'Hide original' : 'Show original'}
              </Button>
              <Button variant="ghost" size="xs" onClick={() => void run(() => store.getState().restore(m.id))}>
                <Undo2 /> Restore
              </Button>
            </span>
          )}
          {original && (
            <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 text-sm text-foreground">{original.body || '(attachment only)'}</p>
          )}
        </div>
      );
    }
    if (editing) {
      return (
        <div className="space-y-1.5">
          <Textarea
            value={draft}
            autoFocus
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (draft.trim())
                  void run(async () => {
                    await store.getState().edit(m.id, draft);
                    setEditing(false);
                  });
              }
            }}
            aria-label="Edit message"
            className="min-h-16"
          />
          <p className="text-[11px] text-subtle-foreground">Enter to save · Esc to cancel</p>
        </div>
      );
    }
    return (
      <>
        {gif && <GifImage url={gif} alt={`GIF from ${name}`} />}
        {m.body && !gif && (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            <Linkified text={m.body} />
            {m.editedAt && <span className="ml-1.5 text-[11px] text-subtle-foreground">(edited)</span>}
          </p>
        )}
        {m.linksRemovedAt && (
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-subtle-foreground">
            <Link2Off className="size-3" aria-hidden="true" /> A moderator removed links from this message.
          </p>
        )}
        {m.attachments.map((a) => (
          <AttachmentView key={a.path} attachment={a} />
        ))}
        {urls.map((u) => (
          <LinkPreviewCard key={u} url={u} />
        ))}
      </>
    );
  })();

  return (
    <article
      id={`msg-${m.id}`}
      className={cn('group relative flex gap-3 rounded-lg px-3 py-0.5 transition-colors hover:bg-accent/30', !grouped && 'mt-3')}
      aria-label={`${name}, ${time(m.createdAt)}`}
    >
      <div className="w-9 shrink-0 pt-0.5">
        {grouped ? (
          <span className="hidden pt-1 text-right text-[10px] text-subtle-foreground group-hover:block">{time(m.createdAt)}</span>
        ) : (
          <Avatar name={name} size="lg" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {replied !== undefined && m.replyTo && (
          <button
            type="button"
            onClick={() => m.replyTo && onJumpTo(m.replyTo)}
            className="mb-0.5 flex max-w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <CornerUpLeft className="size-3 shrink-0" aria-hidden="true" />
            <span className="font-medium">{repliedAuthor?.displayName || repliedAuthor?.username || 'Someone'}</span>
            <span className="truncate">
              {replied
                ? replied.deletedAt
                  ? 'deleted message'
                  : replied.hiddenAt
                    ? 'hidden message'
                    : snippet(replied.body) || 'attachment'
                : 'message not loaded'}
            </span>
          </button>
        )}
        {!grouped && (
          <p className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{name}</span>
            {author && <span className="text-xs text-subtle-foreground">@{author.username}</span>}
            {authorRole && authorRole !== 'member' && <Badge tone={authorRole === 'admin' ? 'brand' : 'neutral'}>{roleLabel[authorRole]}</Badge>}
            <time dateTime={m.createdAt} className="text-[11px] text-subtle-foreground">
              {time(m.createdAt)}
            </time>
          </p>
        )}
        {body}

        {grouping.length > 0 && intact && (
          <fieldset className="m-0 mt-1 flex min-w-0 flex-wrap gap-1 border-0 p-0">
            <legend className="sr-only">Reactions</legend>
            {grouping.map(([emoji, c]) => (
              <button
                key={emoji}
                type="button"
                aria-pressed={c.mine}
                onClick={() => void run(() => store.getState().toggleReaction(m, emoji))}
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-xs transition-colors',
                  c.mine ? 'border-brand/60 bg-brand-soft text-brand-text' : 'hover:bg-accent',
                )}
              >
                <span>{emoji}</span>
                <span className="tabular">{c.n}</span>
              </button>
            ))}
          </fieldset>
        )}
      </div>

      {intact && !editing && (
        <div className="absolute -top-3 right-3 hidden items-center gap-0.5 rounded-lg border bg-popover p-0.5 shadow-sm focus-within:flex group-focus-within:flex group-hover:flex">
          <Popover open={picker} onOpenChange={setPicker}>
            <PopoverTrigger render={<IconButton label="Add reaction" size="icon-xs" />}>
              <SmilePlus />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-1.5">
              <div className="flex gap-0.5">
                {QUICK.map((e) => (
                  <button
                    key={e}
                    type="button"
                    aria-label={`React ${e}`}
                    onClick={() => {
                      setPicker(false);
                      void run(() => store.getState().toggleReaction(m, e));
                    }}
                    className="grid size-8 place-items-center rounded-md text-lg hover:bg-accent"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <IconButton label="Reply" size="icon-xs" onClick={() => store.getState().setReplyTo(m)}>
            <CornerUpLeft />
          </IconButton>
          {(mine || moderator) && (
            <DropdownMenu>
              <DropdownTrigger render={<IconButton label="More actions" size="icon-xs" />}>
                <MoreHorizontal />
              </DropdownTrigger>
              <DropdownContent className="w-52">
                {mine && !m.linksRemovedAt && (
                  <DropdownItem
                    icon={<Pencil />}
                    onClick={() => {
                      setDraft(m.body);
                      setEditing(true);
                    }}
                  >
                    Edit
                  </DropdownItem>
                )}
                {mine && (
                  <DropdownItem icon={<Trash2 />} destructive onClick={() => void run(() => store.getState().remove(m.id))}>
                    Delete
                  </DropdownItem>
                )}
                {moderator && (
                  <>
                    {mine && <DropdownSeparator />}
                    <DropdownItem icon={<EyeOff />} onClick={() => void hide()}>
                      Hide message
                    </DropdownItem>
                    {!m.linksRemovedAt && urls.length + extractUrls(m.body, 1).length > 0 && (
                      <DropdownItem icon={<Link2Off />} onClick={() => void run(() => store.getState().stripLinks(m.id))}>
                        Remove links
                      </DropdownItem>
                    )}
                  </>
                )}
              </DropdownContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </article>
  );
}
