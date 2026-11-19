import { Avatar, type AvatarProps } from '@/components/ui/Avatar';
import { useNote } from '@/features/activity/hooks';
import { NoteBubble, NotePopover } from '@/features/activity/NoteView';
import { cn } from '@/lib/cn';
import { useListening } from './hooks';

/**
 * An `Avatar` that also shows the "listening now" badge when that person is. Pass the account id; without one it is a plain avatar.
 *
 * `note` also shows their note (24 hours, see features/activity) as a speech bubble above the avatar when they have one: `"bubble"` is
 * decoration (safe inside a button, like a chat-list row), `"tap"` makes the bubble a button that opens the note's card. Off by default —
 * a long list of messages shouldn't sprout a bubble on every line.
 */
export function PersonAvatar({ userId, note, ...props }: AvatarProps & { userId: string | null | undefined; note?: 'bubble' | 'tap' }) {
  const listening = useListening(userId);
  const current = useNote(note ? userId : null);
  const avatar = <Avatar {...props} listening={listening !== null} />;
  if (!note || !current) return avatar;
  return (
    // A row gets a little taller when the person has a note: the bubble has its own space above the avatar and never sits on the row above.
    <span className={cn('act-bubble-host relative inline-flex shrink-0', props.size !== 'xl' && 'mt-[19px]')}>
      {avatar}
      {note === 'tap' ? (
        <NotePopover note={current}>
          <NoteBubble note={current} interactive />
        </NotePopover>
      ) : (
        <NoteBubble note={current} />
      )}
    </span>
  );
}
