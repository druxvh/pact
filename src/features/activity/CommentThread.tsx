import { Send, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Avatar, Button, IconButton, Input, Skeleton } from '@/components/ui';
import { cleanText } from '@/features/nowplaying/track';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { notify } from '@/lib/toast';
import { explainError } from './describe';
import { useActivityStore, useMyId } from './hooks';
import { canonicalId, usePerson } from './people';
import type { CommentList } from './store';
import { COMMENT_MAX, type Comment, type MessageContext, refKey, type SubjectRef } from './types';
import { useNow } from './ui';

const NONE: CommentList = { items: [], status: 'idle', more: false, loadingMore: false };

function CommentRow({ comment, subject, canDelete }: { comment: Comment; subject: SubjectRef; canDelete: boolean }) {
  const person = usePerson(comment.authorId);
  const me = useMyId();
  const now = useNow(60_000);
  const pending = comment.id.startsWith('pending:');
  const mine = me !== null && canonicalId(comment.authorId) === me;
  const name = mine ? 'You' : person.name;
  return (
    <li className={cn('group flex items-start gap-2 py-1.5', pending && 'opacity-60')}>
      <Avatar name={person.name} src={person.avatarUrl} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug">
          <span className="font-medium">{name}</span> <span className="break-words">{cleanText(comment.body, COMMENT_MAX)}</span>
        </p>
        <p className="text-[11px] text-subtle-foreground">{pending ? 'Sending…' : relativeTime(comment.createdAt, now)}</p>
      </div>
      {canDelete && !pending && (
        <IconButton
          label={`Delete ${mine ? 'your' : name === 'Someone' ? 'this' : `${name}’s`} comment`}
          size="icon-xs"
          tooltip={false}
          className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
          onClick={() =>
            void useActivityStore
              .getState()
              .deleteComment(subject, comment.id)
              .catch((err) => notify.error('Couldn’t delete that', explainError(err)))
          }
        >
          <Trash2 />
        </IconButton>
      )}
    </li>
  );
}

/**
 * The public comments under a note, with an input (up to 200 characters). Adding and deleting are optimistic and put things back if the
 * server refuses. You can delete your own comments, and any comment on your own note.
 */
export function CommentThread({ subject, context, id, className }: { subject: SubjectRef; context: MessageContext; id?: string; className?: string }) {
  const k = refKey(subject);
  const list = useActivityStore((s) => s.comments[k]) ?? NONE;
  const me = useMyId();
  const inputId = useId();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const ownerIsMe = me !== null && canonicalId(subject.ownerId) === me;
  const clean = text.replace(/\s+/g, ' ').trim();

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key identifies the subject
  useEffect(() => {
    void useActivityStore.getState().loadComments(subject);
  }, [k]);

  const send = async () => {
    if (!clean || clean.length > COMMENT_MAX || sending) return;
    setSending(true);
    setText('');
    try {
      await useActivityStore.getState().addComment(subject, clean, context);
    } catch (err) {
      setText(clean);
      notify.error('Couldn’t post your comment', explainError(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div id={id} className={cn('space-y-1', className)}>
      {list.more && (
        <Button
          variant="ghost"
          size="xs"
          loading={list.loadingMore}
          onClick={() =>
            void useActivityStore
              .getState()
              .loadMoreComments(subject)
              .catch((err) => notify.error('Couldn’t load more', explainError(err)))
          }
        >
          Show earlier comments
        </Button>
      )}
      {list.status === 'loading' && list.items.length === 0 ? (
        <div className="space-y-2 py-1" role="status" aria-label="Loading comments">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-8 w-1/2" />
        </div>
      ) : list.status === 'error' && list.items.length === 0 ? (
        <p role="status" className="py-1 text-xs text-muted-foreground">
          Couldn’t load the comments.{' '}
          <button
            type="button"
            className="text-brand-text underline-offset-2 hover:underline"
            onClick={() => void useActivityStore.getState().loadComments(subject)}
          >
            Try again
          </button>
        </p>
      ) : list.items.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">No comments yet{ownerIsMe ? '.' : ' — say something nice.'}</p>
      ) : (
        <ul aria-label="Comments" className="max-h-64 divide-y divide-border/50 overflow-y-auto">
          {list.items.map((c) => (
            <CommentRow key={c.id} comment={c} subject={subject} canDelete={ownerIsMe || (me !== null && canonicalId(c.authorId) === me)} />
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1.5 pt-1">
        <label htmlFor={inputId} className="sr-only">
          Add a comment
        </label>
        <Input
          id={inputId}
          value={text}
          maxLength={COMMENT_MAX}
          placeholder="Add a comment…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          className="h-8 flex-1 text-[13px]"
        />
        {text.length >= COMMENT_MAX - 50 && (
          <span className="text-[11px] tabular-nums text-warning-text">
            {text.length}/{COMMENT_MAX}
          </span>
        )}
        <IconButton label="Post comment" size="icon-sm" variant="soft" disabled={!clean || sending} onClick={() => void send()}>
          <Send />
        </IconButton>
      </div>
    </div>
  );
}
