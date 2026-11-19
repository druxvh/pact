import { ArrowLeft, Heart, MessageCircle, Send, StickyNote } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, IconButton, Textarea } from '@/components/ui';
import { PersonAvatar } from '@/features/nowplaying/PersonAvatar';
import { safeTrackUrl, sourceLabel } from '@/features/nowplaying/sources';
import { TrackArt } from '@/features/nowplaying/TrackArt';
import { cleanText, parseTrack } from '@/features/nowplaying/track';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { notify } from '@/lib/toast';
import { counterpart, explainError, previewOf } from './describe';
import { useActivityStore, useMyId, useThreads } from './hooks';
import { personInfo, usePerson } from './people';
import { MESSAGES_PAGE } from './store';
import { type ActivityMessage, MESSAGE_MAX, type MessageContext, NOTE_MAX } from './types';
import { useNow } from './ui';

// ── the list (a section of the Direct messages sidebar) ─────────────────────────────────────────────

function ThreadRow({
  personId,
  active,
  unread,
  preview,
  at,
  onSelect,
}: {
  personId: string;
  active: boolean;
  unread: number;
  preview: string;
  at: string;
  onSelect: () => void;
}) {
  const person = usePerson(personId);
  const now = useNow(60_000);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-offset-[-2px] transition-colors duration-150 active:scale-[0.99]',
          active ? 'bg-brand-soft' : 'hover:bg-accent',
        )}
      >
        {active && <span className="absolute left-0 top-3 h-[calc(100%-1.5rem)] w-[3px] rounded-r-full bg-brand" />}
        <PersonAvatar userId={personId} name={person.name} src={person.avatarUrl} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn('truncate text-[13.5px]', unread ? 'font-semibold' : 'font-medium')}>{person.name}</span>
            <span className={cn('shrink-0 text-[11px]', unread ? 'font-medium text-brand-text' : 'text-subtle-foreground')}>{relativeTime(at, now)}</span>
          </span>
          <span className="flex items-center justify-between gap-2">
            <span className={cn('truncate text-xs', unread ? 'text-foreground' : 'text-muted-foreground')}>{preview}</span>
            {unread > 0 && !active && (
              <Badge tone="brand" className="h-[18px] min-w-[18px] justify-center rounded-full bg-brand px-1.5 text-brand-foreground">
                <span className="sr-only">{unread} unread</span>
                <span aria-hidden="true">{unread > 99 ? '99+' : unread}</span>
              </Badge>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * The real people who have liked, commented on or privately replied about your notes and songs (or whom you did) — one entry per person,
 * with an unread count. Hidden when there are none. The simulated chats below it are untouched.
 */
export function ActivityThreadList({ activeId, onSelect, search }: { activeId: string | null; onSelect: (personId: string) => void; search: string }) {
  const threads = useThreads();
  const me = useMyId();
  const [all, setAll] = useState(false);
  const q = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      q
        ? threads.filter(
            (t) =>
              personInfo(t.personId).name.toLowerCase().includes(q) ||
              previewOf(t.last, me ?? '')
                .toLowerCase()
                .includes(q),
          )
        : threads,
    [threads, q, me],
  );
  if (!me || shown.length === 0) return null;
  const visible = all || q ? shown : shown.slice(0, 4);
  return (
    <section aria-label="Note and song activity" className="mb-1">
      <h3 className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
        <StickyNote className="size-3" aria-hidden="true" /> Notes &amp; songs
      </h3>
      <ul className="space-y-0.5 px-1.5">
        {visible.map((t) => (
          <ThreadRow
            key={t.personId}
            personId={t.personId}
            active={t.personId === activeId}
            unread={t.unread}
            preview={previewOf(t.last, me)}
            at={t.last.createdAt}
            onSelect={() => onSelect(t.personId)}
          />
        ))}
      </ul>
      {!all && !q && shown.length > visible.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="w-full rounded-md px-4 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
        >
          Show {shown.length - visible.length} more
        </button>
      )}
      <h3 className="px-3 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">Chats</h3>
    </section>
  );
}

// ── one thread ──────────────────────────────────────────────────────────────────────────────────────

/** What a message is about: the song (cover, title, artist) or the quoted note. Text only; the link is allow-listed again. */
function ContextCard({ context, className }: { context: MessageContext; className?: string }) {
  const track = parseTrack(context.track);
  const text = cleanText(context.text, NOTE_MAX);
  if (!track && !text) return null;
  const href = track ? safeTrackUrl(track.trackUrl, track.source) : null;
  const song = track && (
    <>
      <TrackArt track={track} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-tight">{track.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {track.artist ? `${track.artist} · ${sourceLabel(track.source)}` : sourceLabel(track.source)}
        </span>
      </span>
    </>
  );
  return (
    <div className={cn('space-y-1.5 rounded-lg border bg-muted/40 p-2', className)} data-context={context.kind}>
      {text && (
        <p className="border-l-2 border-brand/50 pl-2 text-[13px] leading-snug">
          <span className="sr-only">Note: </span>
          {text}
        </p>
      )}
      {song &&
        (href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={`Open on ${sourceLabel(track.source)}`}
            className="flex items-center gap-2 rounded-md transition-colors hover:bg-accent"
          >
            {song}
          </a>
        ) : (
          <div className="flex items-center gap-2">{song}</div>
        ))}
    </div>
  );
}

const what = (c: MessageContext | null) => (c?.kind === 'listening' ? 'song' : 'note');

function MessageView({ m, me, name }: { m: ActivityMessage; me: string; name: string }) {
  const mine = m.senderId === me;
  const now = useNow(60_000);
  const time = <span className="text-[11px] text-subtle-foreground">{relativeTime(m.createdAt, now)}</span>;

  if (m.kind === 'like') {
    return (
      <li className="my-2 flex justify-center">
        <div className="w-full max-w-sm rounded-lg border bg-card p-2.5 shadow-xs">
          <p className="flex items-center gap-1.5 text-[13px]">
            <Heart className="size-4 shrink-0 fill-current text-destructive-text" aria-hidden="true" />
            <span className="min-w-0 flex-1">{mine ? `You liked ${name}’s ${what(m.context)}` : `${name} liked your ${what(m.context)}`}</span>
            {time}
          </p>
          {m.context && <ContextCard context={m.context} className="mt-2" />}
        </div>
      </li>
    );
  }

  return (
    <li className={cn('my-1.5 flex', mine ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[min(26rem,85%)]', mine ? 'items-end' : 'items-start')}>
        {m.context && (
          <p className={cn('mb-1 flex items-center gap-1 text-[11px] text-subtle-foreground', mine && 'justify-end')}>
            <MessageCircle className="size-3" aria-hidden="true" />
            {m.kind === 'comment' ? (mine ? 'You commented on' : 'Commented on') : mine ? 'You replied about' : 'Replied about'} {mine ? 'their' : 'your'}{' '}
            {what(m.context)}
          </p>
        )}
        {m.context && <ContextCard context={m.context} className="mb-1" />}
        <p className={cn('break-words rounded-lg px-3 py-2 text-[13.5px] leading-snug', mine ? 'bg-brand text-brand-foreground' : 'border bg-card')}>
          {cleanText(m.body, MESSAGE_MAX)}
        </p>
        <p className={cn('mt-0.5', mine ? 'text-right' : 'text-left')}>{time}</p>
      </div>
    </li>
  );
}

/**
 * One person's activity thread: their likes, comments and private replies about your notes and songs (and yours about theirs), each with
 * a card of what it was about, and a box to reply. It says plainly what these threads are for. Opening it marks what is addressed to you
 * as read, and anything that arrives while it is open is read as it arrives.
 */
export function ActivityThread({ personId, onBack }: { personId: string; onBack?: () => void }) {
  const person = usePerson(personId);
  const me = useMyId();
  const messages = useActivityStore((s) => s.messages);
  const status = useActivityStore((s) => s.messagesStatus);
  const fieldId = useId();
  const scroller = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const thread = useMemo(
    () =>
      me ? messages.filter((m) => counterpart(m, me) === personId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) : [],
    [messages, me, personId],
  );

  useEffect(() => {
    const store = useActivityStore.getState();
    store.setViewing(personId);
    void store.loadThread(personId).catch(() => {});
    return () => useActivityStore.getState().setViewing(null);
  }, [personId]);

  // new messages: stay at the bottom (the container only — never the page)
  const last = thread.at(-1)?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `last` is the trigger
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);

  const clean = text.replace(/\s+/g, ' ').trim();
  const ok = clean.length > 0 && clean.length <= MESSAGE_MAX && !sending;
  const send = async () => {
    if (!ok) return;
    setSending(true);
    try {
      await useActivityStore.getState().sendReply(personId, clean, null);
      setText('');
    } catch (err) {
      notify.error('Couldn’t send that', explainError(err));
    } finally {
      setSending(false);
    }
  };

  const loadOlder = async () => {
    const oldest = thread[0];
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const n = await useActivityStore.getState().loadThread(personId, oldest.createdAt);
      if (n === 0) setExhausted(true);
    } catch (err) {
      notify.error('Couldn’t load earlier messages', explainError(err));
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <section aria-label={`Note and song activity with ${person.name}`} className="relative flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3 md:px-4">
        {onBack && (
          <IconButton label="Back to chats" size="icon-sm" onClick={onBack} className="md:hidden">
            <ArrowLeft />
          </IconButton>
        )}
        <PersonAvatar userId={personId} name={person.name} src={person.avatarUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold leading-tight tracking-tight">{person.name}</h2>
          <p className="truncate text-xs text-muted-foreground">{person.username ? `@${person.username} · ` : ''}Notes &amp; songs</p>
        </div>
      </header>

      <p className="flex items-start gap-2 border-b bg-muted/30 px-4 py-2 text-xs leading-snug text-muted-foreground">
        <StickyNote className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        Likes, comments and private replies about notes and songs. For everything else, chat in a community.
      </p>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-3 md:px-4" role="log" aria-live="polite" aria-relevant="additions">
        {thread.length >= MESSAGES_PAGE && !exhausted && (
          <div className="flex justify-center pb-2">
            <Button variant="ghost" size="xs" loading={loadingOlder} onClick={() => void loadOlder()}>
              Show earlier messages
            </Button>
          </div>
        )}
        {thread.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">
            {status === 'loading' || status === 'idle' ? 'Loading…' : status === 'error' ? 'Couldn’t load this conversation.' : 'Nothing here yet.'}
          </p>
        ) : (
          <ul>
            {thread.map((m) => (
              <MessageView key={m.id} m={m} me={me ?? ''} name={person.name} />
            ))}
          </ul>
        )}
      </div>

      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor={fieldId} className="sr-only">
          Reply to {person.name}
        </label>
        <Textarea
          id={fieldId}
          rows={1}
          value={text}
          maxLength={MESSAGE_MAX}
          placeholder={`Reply to ${person.name}…`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          className="min-h-9 flex-1 text-[13px]"
        />
        {text.length > MESSAGE_MAX - 50 && (
          <span className="pb-2 text-[11px] tabular-nums text-warning-text">
            {text.length}/{MESSAGE_MAX}
          </span>
        )}
        <Button type="submit" variant="primary" disabled={!ok} loading={sending}>
          <Send aria-hidden="true" /> Send
        </Button>
      </form>
    </section>
  );
}
