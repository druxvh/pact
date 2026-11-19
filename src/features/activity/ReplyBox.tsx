import { Send } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { useNavStore } from '@/store/useNavStore';
import { explainError } from './describe';
import { sendPrivateReply } from './reply';
import { MESSAGE_MAX, type MessageContext } from './types';

/**
 * A private reply about a note or a song, inline: up to 500 characters, Enter sends (Shift+Enter is a line break the server would
 * flatten anyway, so it just sends too — one line of text). Says plainly that only they will see it. If sending fails the text stays.
 */
export function ReplyBox({
  to,
  name,
  context,
  onDone,
  className,
}: {
  to: string;
  name: string;
  context: MessageContext | null;
  onDone?: () => void;
  className?: string;
}) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const go = useNavStore((s) => s.go);
  const clean = text.replace(/\s+/g, ' ').trim();
  const ok = clean.length > 0 && clean.length <= MESSAGE_MAX && !sending;

  useEffect(() => {
    field.current?.focus();
  }, []);

  const send = async () => {
    if (!ok) return;
    setSending(true);
    try {
      const r = await sendPrivateReply(to, clean, context);
      notify.action(`Sent to ${name}`, r.where === 'chat' ? 'Open chat' : 'View thread', () => go('chat', r.sub), 'Only they can see it.');
      setText('');
      onDone?.();
    } catch (err) {
      notify.error('Couldn’t send that', explainError(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[11px] text-subtle-foreground">
        Private reply to {name} — only they see it
      </label>
      <Textarea
        id={id}
        ref={field}
        rows={2}
        value={text}
        maxLength={MESSAGE_MAX}
        placeholder="Write a reply…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
        className="min-h-14 text-[13px]"
      />
      <div className="flex items-center justify-between gap-2">
        <span className={cn('text-[11px] tabular-nums', text.length > MESSAGE_MAX - 50 ? 'text-warning-text' : 'text-subtle-foreground')} aria-live="polite">
          {text.length}/{MESSAGE_MAX}
        </span>
        <Button variant="primary" size="sm" disabled={!ok} loading={sending} onClick={() => void send()}>
          <Send aria-hidden="true" /> Send
        </Button>
      </div>
    </div>
  );
}
