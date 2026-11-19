import { Heart } from 'lucide-react';
import { useState } from 'react';
import { useMotionOff } from '@/features/camera/useMotionOff';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import './activity.css';
import { heartFailure } from './describe';
import { useActivityStore, useEngagement, useMyId } from './hooks';
import { canonicalId } from './people';
import type { MessageContext, SubjectRef } from './types';

const ANGLES = [0, 60, 120, 180, 240, 300];

/** The heart itself: an outline, or filled when liked; when it is given it pops and six dots fly out. Decorative — the button names it. */
export function HeartGlyph({ liked, burst = 0, motionOff }: { liked: boolean; burst?: number; motionOff: boolean }) {
  return (
    <span
      key={burst}
      aria-hidden="true"
      className="act-heart"
      data-liked={liked ? '' : undefined}
      data-pop={burst > 0 ? '' : undefined}
      data-burst={burst > 0 ? '' : undefined}
      data-motion={motionOff ? 'off' : 'on'}
    >
      <Heart className="size-4" strokeWidth={2} />
      {ANGLES.map((a) => (
        <i key={a} style={{ '--a': `${a}deg` } as React.CSSProperties} />
      ))}
    </span>
  );
}

/** "3 hearts" — for the accessible name. */
const hearts = (n: number) => `${n} ${n === 1 ? 'heart' : 'hearts'}`;

/**
 * A heart on a note or on someone's song. Everyone sees how many people gave one; you see whether you did. It is optimistic: the count
 * moves at once, and if the server says no, the count goes back and you are told. It never offers a heart on your own things — you see the
 * number, not a button.
 *
 * `what` completes the accessible name ("Like Maya’s note"); `aria-pressed` carries whether you already did.
 */
export function HeartButton({ subject, context, what, className }: { subject: SubjectRef; context: MessageContext; what: string; className?: string }) {
  const e = useEngagement(subject);
  const me = useMyId();
  const motionOff = useMotionOff();
  const [burst, setBurst] = useState(0);
  const own = me !== null && canonicalId(subject.ownerId) === me;

  if (own) {
    return (
      <span
        className={cn('inline-flex h-7 items-center gap-1 px-1.5 text-xs text-muted-foreground', className)}
        title={`Hearts on your ${subject.kind === 'note' ? 'note' : 'song'}`}
      >
        <Heart className="size-4" aria-hidden="true" />
        <span className="tabular-nums">
          {e.likes}
          <span className="sr-only">
            {' '}
            {e.likes === 1 ? 'heart' : 'hearts'} on your {subject.kind === 'note' ? 'note' : 'song'}
          </span>
        </span>
      </span>
    );
  }

  const liked = e.likedByMe;
  const press = () => {
    if (!liked) setBurst((n) => n + 1);
    useActivityStore
      .getState()
      .toggleLike(subject, context)
      .catch((err) => {
        const f = heartFailure(err, subject.kind);
        notify.error(f.title, f.description);
      });
  };

  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={`Like ${what}${e.likes > 0 ? `, ${hearts(e.likes)}` : ''}`}
      onClick={press}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium transition-colors hover:bg-accent',
        liked ? 'text-destructive-text' : 'text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      <HeartGlyph liked={liked} burst={burst} motionOff={motionOff} />
      {e.likes > 0 && <span className="tabular-nums">{e.likes}</span>}
    </button>
  );
}
