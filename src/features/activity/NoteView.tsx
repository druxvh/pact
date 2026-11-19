import { Music2, Pencil } from 'lucide-react';
import type { ReactElement } from 'react';
import { Avatar, Button, Popover, PopoverContent, PopoverTrigger } from '@/components/ui';
import { useMotionOff } from '@/features/camera/useMotionOff';
import { ListeningRow } from '@/features/nowplaying/ListeningRow';
import { cleanText, parseTrack } from '@/features/nowplaying/track';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import './activity.css';
import { contextOfNote, refOfNote, timeLeft } from './describe';
import { useMyId } from './hooks';
import { canonicalId, usePerson } from './people';
import { ReactionBar } from './ReactionBar';
import { NOTE_MAX, type Note } from './types';
import { openNoteComposer, useNow } from './ui';

/** The text of a note, cleaned again (it is another person's input) and capped. */
export const noteText = (note: Pick<Note, 'text'>): string => cleanText(note.text, NOTE_MAX);

/** What a note says for the bubble: its text, or — for a song-only note — the song's title. */
export function bubbleText(note: Pick<Note, 'text' | 'track'>): string {
  return noteText(note) || parseTrack(note.track)?.title || '';
}

/**
 * The speech bubble above an avatar: a small chip with the note, cut to one line (a music note in front when a song is pinned). Hovering
 * the avatar shows the whole note. `interactive` turns it into a button (it is the trigger of the note's card); without it the bubble is
 * decoration — so it can sit inside another button, like a row of the chat list — and the text is still there for screen readers.
 */
export function NoteBubble({
  note,
  interactive,
  className,
  ...rest
}: {
  note: Note;
  interactive?: boolean;
  className?: string;
} & Record<string, unknown>) {
  const motionOff = useMotionOff();
  const text = bubbleText(note);
  if (!text) return null;
  const hasSong = parseTrack(note.track) !== null;
  const shell = cn(
    'act-bubble absolute left-0 z-10 flex min-h-4 items-center gap-1 rounded-md border bg-popover px-1.5 text-[10px] font-medium leading-4 text-popover-foreground shadow-sm',
    'bottom-[calc(100%+3px)]',
    interactive && 'cursor-pointer outline-offset-2',
    className,
  );
  const inner = (
    <>
      {hasSong && <Music2 className="size-2.5 shrink-0 text-brand-text" aria-hidden="true" />}
      <span data-clip="" className="min-w-0 truncate">
        {text}
      </span>
      <span aria-hidden="true" className="absolute -bottom-[3px] left-3 size-1.5 rotate-45 border-b border-r bg-popover" />
    </>
  );
  if (interactive) {
    return (
      <button type="button" className={shell} data-motion={motionOff ? 'off' : 'on'} aria-label={`Note: ${text}`} {...rest}>
        {inner}
      </button>
    );
  }
  return (
    <span className={shell} data-motion={motionOff ? 'off' : 'on'} title={text} {...rest}>
      <span className="sr-only">Note: </span>
      {inner}
    </span>
  );
}

/** A note's words and its song, as a block (feed cards, the profile card, the note popover). */
export function NoteContent({ note, size = 'md', className }: { note: Note; size?: 'md' | 'lg'; className?: string }) {
  const text = noteText(note);
  const track = parseTrack(note.track);
  return (
    <div className={cn('space-y-2', className)}>
      {text && <p className="whitespace-pre-line break-words text-[14px] leading-snug">{text}</p>}
      {track && <ListeningRow track={track} size={size} label="Song" live={false} />}
    </div>
  );
}

/**
 * Tap a note's bubble: a small card with the note, its song, a heart, comments and a private reply (or, on your own note, how long it has left
 * and a way to change it). `children` is the bubble — the trigger.
 */
export function NotePopover({ note, children }: { note: Note; children: ReactElement<Record<string, unknown>> }) {
  const person = usePerson(note.ownerId);
  const me = useMyId();
  const now = useNow(30_000);
  const mine = me !== null && canonicalId(note.ownerId) === me;
  const name = mine ? 'You' : person.name;
  return (
    <Popover>
      <PopoverTrigger render={children} />
      <PopoverContent align="start" side="bottom" className="w-[min(20rem,calc(100vw-1.5rem))] p-3">
        <div className="flex items-center gap-2">
          <Avatar name={person.name} src={person.avatarUrl} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-tight">{name}</p>
            <p className="text-[11px] text-subtle-foreground">
              {relativeTime(note.createdAt, now)}
              {mine && ` · ${timeLeft(note.expiresAt, now)}`}
            </p>
          </div>
          {mine && (
            <Button variant="ghost" size="xs" onClick={openNoteComposer}>
              <Pencil aria-hidden="true" /> Edit
            </Button>
          )}
        </div>
        <NoteContent note={note} className="mt-2.5" />
        <ReactionBar
          subject={refOfNote(note)}
          context={contextOfNote(note)}
          ownerName={person.name}
          what={mine ? 'your note' : `${person.name}’s note`}
          className="mt-2 border-t border-border/60 pt-1.5"
        />
      </PopoverContent>
    </Popover>
  );
}
