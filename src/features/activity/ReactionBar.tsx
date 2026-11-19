import { CornerUpLeft, MessageCircle } from 'lucide-react';
import { useId, useState } from 'react';
import { cn } from '@/lib/cn';
import { CommentThread } from './CommentThread';
import { HeartButton } from './HeartButton';
import { useEngagement, useMyId } from './hooks';
import { canonicalId } from './people';
import { ReplyBox } from './ReplyBox';
import type { MessageContext, SubjectRef } from './types';

type Panel = 'comments' | 'reply' | null;

const chip =
  'inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';

/**
 * Everything you can do about a note or a song: a heart (with its count), comments (notes only — a live song has nothing for them to stay
 * attached to) and a private reply. Comments and the reply open inline underneath. `what` completes the accessible names, e.g. "Maya’s note".
 * On your own things it shows the numbers and the comments, but no heart to press and no one to reply to.
 */
export function ReactionBar({
  subject,
  context,
  ownerName,
  what,
  compact,
  className,
}: {
  subject: SubjectRef;
  context: MessageContext;
  ownerName: string;
  what: string;
  /** Shorter labels (inside a profile card). */
  compact?: boolean;
  className?: string;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const e = useEngagement(subject);
  const me = useMyId();
  const own = me !== null && canonicalId(subject.ownerId) === me;
  const uid = useId();
  const canComment = subject.kind === 'note';
  const toggle = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));

  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex flex-wrap items-center gap-0.5">
        <HeartButton subject={subject} context={context} what={what} />
        {canComment && (
          <button
            type="button"
            className={cn(chip, panel === 'comments' && 'bg-accent text-foreground')}
            aria-expanded={panel === 'comments'}
            aria-controls={`${uid}-comments`}
            aria-label={`Comments on ${what}${e.comments > 0 ? `, ${e.comments}` : ''}`}
            onClick={() => toggle('comments')}
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            {e.comments > 0 && <span className="tabular-nums">{e.comments}</span>}
            {!compact && e.comments === 0 && <span>Comment</span>}
          </button>
        )}
        {!own && (
          <button
            type="button"
            className={cn(chip, panel === 'reply' && 'bg-accent text-foreground')}
            aria-expanded={panel === 'reply'}
            aria-controls={`${uid}-reply`}
            onClick={() => toggle('reply')}
          >
            <CornerUpLeft className="size-4" aria-hidden="true" />
            {compact ? 'Reply' : 'Reply privately'}
          </button>
        )}
      </div>
      {panel === 'comments' && canComment && (
        <CommentThread id={`${uid}-comments`} subject={subject} context={context} className="mt-1.5 border-t border-border/60 pt-1.5" />
      )}
      {panel === 'reply' && !own && (
        <div id={`${uid}-reply`} className="mt-1.5 border-t border-border/60 pt-2">
          <ReplyBox to={subject.ownerId} name={ownerName} context={context} onDone={() => setPanel(null)} />
        </div>
      )}
    </div>
  );
}
