import { CornerUpLeft, Paperclip, SendHorizonal, Smile, Timer, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { IconButton, Popover, PopoverContent, PopoverTrigger, Spinner, Textarea } from '@/components/ui';
import { EmojiPicker } from '@/features/chat/EmojiPicker';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { notify } from '@/lib/toast';
import { GifPicker } from './GifPicker';
import { snippet } from './links';
import { describeError } from './mapping';
import { can } from './permissions';
import { formatUntil, formatWait, slowmodeLabel } from './safety';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, ATTACHMENTS_MAX, type Attachment, type Channel, MESSAGE_MAX, type Role } from './types';
import { getCommunityApi, useCommunityStore } from './useCommunityStore';
import { useMyTimeout, useSlowmodeWait } from './useSafety';

type Pending = { id: string; file: File; preview: string | null; status: 'uploading' | 'done' | 'error'; attachment?: Attachment; error?: string };

export function Composer({ communityId, channel, role }: { communityId: string; channel: Channel; role: Role }) {
  const channelName = channel.name;
  const timedOutUntil = useMyTimeout(communityId);
  const waitMs = useSlowmodeWait(channel, role);
  const waiting = waitMs > 0;
  const replyTo = useCommunityStore((s) => s.replyTo);
  const replyAuthor = useCommunityStore((s) => (s.replyTo ? s.profiles[s.replyTo.authorId] : undefined));
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [over, setOver] = useState(false);
  const [gifOpen, setGifOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const uploading = pending.some((p) => p.status === 'uploading');
  const ready = pending.filter((p) => p.status === 'done' && p.attachment).map((p) => p.attachment as Attachment);
  const timedOut = timedOutUntil !== null;
  const canSend = !sending && !uploading && !timedOut && !waiting && (text.trim().length > 0 || ready.length > 0);

  const addFiles = (files: File[]) => {
    if (timedOut) return;
    const room = ATTACHMENTS_MAX - pending.length;
    if (files.length > room) notify.info(`Up to ${ATTACHMENTS_MAX} files per message`, room > 0 ? `Added the first ${room}.` : undefined);
    for (const file of files.slice(0, Math.max(0, room))) {
      if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
        notify.error(`${file.name}`, 'Only PNG, JPEG, GIF, WebP, MP4 and WebM files can be shared.');
        continue;
      }
      if (file.size > ATTACHMENT_MAX_BYTES) {
        notify.error(`${file.name}`, `That’s ${formatBytes(file.size)} — the limit is ${formatBytes(ATTACHMENT_MAX_BYTES)}.`);
        continue;
      }
      const id = crypto.randomUUID();
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      setPending((c) => [...c, { id, file, preview, status: 'uploading' }]);
      getCommunityApi()
        .uploadAttachment(communityId, file)
        .then((attachment) => setPending((c) => c.map((p) => (p.id === id ? { ...p, status: 'done', attachment } : p))))
        .catch((err) => setPending((c) => c.map((p) => (p.id === id ? { ...p, status: 'error', error: describeError(err) } : p))));
    }
  };

  /** A GIF goes out as its own message right away (like in Discord); whatever you were typing stays in the box. */
  const sendGif = async (url: string) => {
    setGifOpen(false);
    if (timedOut || waiting) return;
    try {
      await useCommunityStore.getState().send(url, []);
    } catch (err) {
      notify.error('Couldn’t send the GIF', describeError(err));
    }
    areaRef.current?.focus();
  };

  const drop = (id: string) =>
    setPending((c) => {
      const gone = c.find((p) => p.id === id);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return c.filter((p) => p.id !== id);
    });

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await useCommunityStore.getState().send(text, ready);
      setText('');
      for (const p of pending) if (p.preview) URL.revokeObjectURL(p.preview);
      setPending([]);
      areaRef.current?.focus();
    } catch (err) {
      notify.error('Couldn’t send', describeError(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="px-4 pb-4 pt-1">
      {replyTo && (
        <div className="mb-1 flex items-center gap-2 rounded-t-lg border border-b-0 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <CornerUpLeft className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">
            Replying to <span className="font-medium text-foreground">{replyAuthor?.displayName || replyAuthor?.username || 'a message'}</span>
            {replyTo.body ? ` — ${snippet(replyTo.body)}` : ''}
          </span>
          <IconButton label="Cancel reply" size="icon-xs" onClick={() => useCommunityStore.getState().setReplyTo(null)}>
            <X />
          </IconButton>
        </div>
      )}

      {pending.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attachments">
          {pending.map((p) => (
            <li
              key={p.id}
              className={cn(
                'relative flex h-16 items-center gap-2 overflow-hidden rounded-lg border bg-card pr-7',
                p.status === 'error' && 'border-destructive/60',
              )}
            >
              {p.preview ? (
                <img src={p.preview} alt="" className="size-16 object-cover" />
              ) : (
                <span className="grid size-16 place-items-center bg-muted text-[11px] text-muted-foreground">video</span>
              )}
              <span className="max-w-32 text-xs">
                <span className="block truncate font-medium">{p.file.name}</span>
                <span className={cn('block truncate', p.status === 'error' ? 'text-destructive-text' : 'text-muted-foreground')}>
                  {p.status === 'uploading' ? 'Uploading…' : p.status === 'error' ? p.error : formatBytes(p.file.size)}
                </span>
              </span>
              {p.status === 'uploading' && <Spinner className="absolute right-2 top-2" />}
              <IconButton label={`Remove ${p.file.name}`} size="icon-xs" className="absolute right-0.5 top-0.5" onClick={() => drop(p.id)}>
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drag-and-drop target; the paperclip button is the keyboard route */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          addFiles(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          'flex items-end gap-1 rounded-lg border bg-card/60 p-1.5 transition-colors',
          over && 'border-brand bg-brand-soft',
          replyTo && 'rounded-t-none',
          timedOut && 'opacity-60',
        )}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ATTACHMENT_TYPES.join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <IconButton label="Attach images, GIFs or video" size="icon" disabled={timedOut} onClick={() => fileRef.current?.click()}>
          <Paperclip />
        </IconButton>
        <Textarea
          ref={areaRef}
          value={text}
          maxLength={MESSAGE_MAX}
          rows={1}
          disabled={timedOut}
          placeholder={timedOut ? `You’re timed out until ${formatUntil(timedOutUntil)}` : `Message #${channelName}`}
          aria-label={`Message #${channelName}`}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) useCommunityStore.getState().announceTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(); // (does nothing while slowmode or a timeout applies)
            }
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          className="max-h-40 min-h-9 flex-1 border-0 bg-transparent py-2 shadow-none focus-visible:ring-0"
        />
        <Popover open={gifOpen} onOpenChange={setGifOpen}>
          <PopoverTrigger render={<IconButton label="Add a GIF" size="icon" disabled={timedOut || waiting} />}>
            <span className="text-[11px] font-bold leading-none tracking-tight">GIF</span>
          </PopoverTrigger>
          <PopoverContent align="end" side="top" className="w-auto p-2">
            <GifPicker onPick={(gif) => void sendGif(gif.url)} />
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger render={<IconButton label="Add emoji" size="icon" disabled={timedOut} />}>
            <Smile />
          </PopoverTrigger>
          <PopoverContent align="end" side="top" className="w-auto p-2">
            <EmojiPicker onPick={(emoji) => setText((t) => t + emoji)} />
          </PopoverContent>
        </Popover>
        {waiting && (
          <span aria-hidden="true" className="tabular self-center px-1 text-xs font-semibold text-muted-foreground">
            {formatWait(waitMs / 1000)}
          </span>
        )}
        <IconButton
          label={waiting ? 'Send message (slowmode: wait for the countdown)' : 'Send message'}
          size="icon"
          variant="primary"
          disabled={!canSend}
          onClick={() => void send()}
        >
          {sending ? <Spinner /> : <SendHorizonal />}
        </IconButton>
      </div>
      {timedOut ? (
        <p role="status" className="mt-1 flex items-center gap-1.5 px-1 text-[12px] text-warning-text">
          <Timer className="size-3.5 shrink-0" aria-hidden="true" />
          You’re timed out until {formatUntil(timedOutUntil)}. You can read, but not send messages or react.
        </p>
      ) : channel.slowmodeSeconds > 0 ? (
        <p className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-subtle-foreground">
          <Timer className="size-3 shrink-0" aria-hidden="true" />
          {can(role, 'bypassSlowmode')
            ? `Slowmode is on (${slowmodeLabel(channel.slowmodeSeconds)}) — it doesn’t apply to you.`
            : waiting
              ? `Slowmode: you can send again in ${formatWait(waitMs / 1000)}.`
              : `Slowmode: one message every ${slowmodeLabel(channel.slowmodeSeconds)}.`}
        </p>
      ) : (
        <p className="mt-1 px-1 text-[11px] text-subtle-foreground">Enter to send · Shift+Enter for a new line · paste or drop images and GIFs</p>
      )}
    </div>
  );
}
