import { ImagePlus, Send, Smile, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconButton, Popover, PopoverContent, PopoverTrigger } from '@/components/ui';
import { EmojiPicker } from '@/features/chat/EmojiPicker';
import { putBlob } from '@/features/chat/idb';
import { useChatStore } from '@/features/chat/store';
import { type Attachment, MAX_ATTACHMENT_BYTES, MAX_MESSAGE_LENGTH } from '@/features/chat/types';
import { cn } from '@/lib/cn';
import { formatBytes, uid } from '@/lib/format';
import { spring } from '@/lib/motion';
import { notify } from '@/lib/toast';
import { sendMessage } from '@/store/demoServer';

const MAX_FILES = 4;

type Pending = { key: string; file: File; url: string };

function replyLabel(body: string, hasAttachment: boolean) {
  return body.trim() || (hasAttachment ? 'Attachment' : '');
}

export function Composer({
  conversationId,
  replyAuthor,
  disabledHint,
  registerAddFiles,
}: {
  conversationId: string;
  replyAuthor?: string;
  disabledHint?: string;
  /** The thread hands us a function so drag-and-drop over the whole thread can attach files. */
  registerAddFiles: (fn: (files: File[]) => void) => void;
}) {
  const draft = useChatStore((s) => s.drafts[conversationId] ?? '');
  const setDraft = useChatStore((s) => s.setDraft);
  const replyId = useChatStore((s) => s.replyingTo[conversationId] ?? null);
  const setReplyingTo = useChatStore((s) => s.setReplyingTo);
  const replyMsg = useChatStore((s) => (replyId ? s.messages.find((m) => m.id === replyId) : undefined));
  const pushRecent = useChatStore((s) => s.pushRecentEmoji);

  const [text, setText] = useState(draft);
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  // New conversation → load its draft; focus the box.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the conversation changes
  useEffect(() => {
    setText(useChatStore.getState().drafts[conversationId] ?? '');
    setPending((p) => {
      for (const x of p) URL.revokeObjectURL(x.url);
      return [];
    });
    taRef.current?.focus();
  }, [conversationId]);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const persistDraft = (value: string) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => setDraft(conversationId, value), 350);
  };

  const addFiles = useCallback((files: File[]) => {
    const ok: Pending[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
        notify.error('Unsupported file', `${file.name} isn’t an image or video.`);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        notify.error(
          'File too large',
          `${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}. Try the Image tool to shrink it.`,
        );
        continue;
      }
      ok.push({ key: uid('p'), file, url: URL.createObjectURL(file) });
    }
    setPending((prev) => {
      const merged = [...prev, ...ok];
      if (merged.length > MAX_FILES) {
        notify.info(`Up to ${MAX_FILES} attachments per message`);
        for (const x of merged.slice(MAX_FILES)) URL.revokeObjectURL(x.url);
      }
      return merged.slice(0, MAX_FILES);
    });
    taRef.current?.focus();
  }, []);

  useEffect(() => registerAddFiles(addFiles), [registerAddFiles, addFiles]);

  const removePending = (key: string) =>
    setPending((p) => {
      const gone = p.find((x) => x.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return p.filter((x) => x.key !== key);
    });

  const canSend = (text.trim().length > 0 || pending.length > 0) && !sending && text.length <= MAX_MESSAGE_LENGTH;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const attachments: Attachment[] = [];
      for (const p of pending) {
        const id = uid('att');
        await putBlob(id, p.file);
        const isVideo = p.file.type.startsWith('video/');
        const dims = isVideo
          ? null
          : await createImageBitmap(p.file)
              .then((b) => {
                const d = { width: b.width, height: b.height };
                b.close();
                return d;
              })
              .catch(() => null);
        attachments.push({ id, kind: isVideo ? 'video' : 'image', name: p.file.name, size: p.file.size, mime: p.file.type, ...dims });
      }
      sendMessage({ conversationId, body: text, attachments, replyTo: replyId ?? undefined });
      for (const p of pending) URL.revokeObjectURL(p.url);
      setPending([]);
      setText('');
      window.clearTimeout(saveTimer.current);
    } catch {
      notify.error('Couldn’t send', 'Your browser blocked storing the attachment.');
    } finally {
      setSending(false);
      taRef.current?.focus();
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = taRef.current;
    const s = el?.selectionStart ?? text.length;
    const e = el?.selectionEnd ?? text.length;
    const next = text.slice(0, s) + emoji + text.slice(e);
    setText(next);
    persistDraft(next);
    pushRecent(emoji);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s + emoji.length, s + emoji.length);
    });
  };

  return (
    <div className="border-t bg-background/60 p-3">
      <AnimatePresence initial={false}>
        {replyMsg && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring.soft}
            className="overflow-hidden"
          >
            <div className="mb-2 flex items-center gap-2 rounded-xl border-l-2 border-brand bg-muted/60 py-1.5 pl-3 pr-1.5 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-brand-text">Replying to {replyAuthor}</p>
                <p className="truncate text-muted-foreground">{replyLabel(replyMsg.body, Boolean(replyMsg.attachments?.length))}</p>
              </div>
              <IconButton label="Cancel reply" size="icon-xs" tooltip={false} onClick={() => setReplyingTo(conversationId, null)}>
                <X />
              </IconButton>
            </div>
          </motion.div>
        )}
        {pending.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring.soft}
            className="overflow-hidden"
          >
            <div className="mb-2 flex flex-wrap gap-2">
              {pending.map((p) => (
                <motion.div
                  key={p.key}
                  layout
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="group relative size-16 overflow-hidden rounded-xl border bg-muted"
                >
                  {p.file.type.startsWith('video/') ? (
                    // biome-ignore lint/a11y/useMediaCaption: preview thumbnail
                    <video src={p.url} className="size-full object-cover" muted />
                  ) : (
                    <img src={p.url} alt={p.file.name} className="size-full object-cover" />
                  )}
                  <button
                    type="button"
                    onClick={() => removePending(p.key)}
                    aria-label={`Remove ${p.file.name}`}
                    className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                  >
                    <X className="size-3" />
                  </button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        className={cn(
          'flex items-end gap-1 rounded-2xl border bg-card px-2 py-1.5 transition-[border-color,box-shadow] duration-150',
          'focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15',
        )}
      >
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger render={<IconButton label="Emoji" size="icon" className="shrink-0" />}>
            <Smile />
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="p-0">
            <EmojiPicker onPick={insertEmoji} />
          </PopoverContent>
        </Popover>
        <IconButton label="Attach image or video (max 5 MB)" size="icon" className="shrink-0" onClick={() => fileRef.current?.click()}>
          <ImagePlus />
        </IconButton>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          multiple
          className="sr-only"
          aria-label="Attach files"
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />

        <textarea
          ref={taRef}
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value);
            persistDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            } else if (e.key === 'Escape' && replyId) {
              e.preventDefault();
              setReplyingTo(conversationId, null);
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          placeholder={disabledHint ?? 'Message…'}
          aria-label="Message"
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-[14px] leading-snug outline-none [field-sizing:content] placeholder:text-subtle-foreground"
        />

        {text.length > MAX_MESSAGE_LENGTH - 500 && (
          <span className={cn('tabular mb-2.5 text-[11px]', text.length > MAX_MESSAGE_LENGTH ? 'text-destructive-text' : 'text-subtle-foreground')}>
            {MAX_MESSAGE_LENGTH - text.length}
          </span>
        )}

        <motion.button
          type="button"
          onClick={() => void send()}
          disabled={!canSend}
          aria-label="Send message"
          whileTap={{ scale: 0.88 }}
          animate={{ scale: canSend ? 1 : 0.92, opacity: canSend ? 1 : 0.45 }}
          transition={spring.snappy}
          className="mb-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-brand text-brand-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.28)] outline-offset-2"
        >
          <Send className="size-[17px]" />
        </motion.button>
      </div>
      <p className="mt-1.5 px-2 text-[11px] text-subtle-foreground">
        <kbd className="font-mono">Enter</kbd> to send · <kbd className="font-mono">Shift+Enter</kbd> for a new line · images &amp; video up to 5 MB
      </p>
    </div>
  );
}
