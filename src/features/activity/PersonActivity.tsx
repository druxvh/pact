import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui';
import { ListeningRow } from '@/features/nowplaying/ListeningRow';
import { parseTrack, type Track } from '@/features/nowplaying/track';
import { relativeTime } from '@/lib/format';
import { contextOfNote, contextOfSong, refOfListening, refOfNote, timeLeft } from './describe';
import { useMyId, useNote } from './hooks';
import { NoteContent } from './NoteView';
import { canonicalId } from './people';
import { ReactionBar } from './ReactionBar';
import { trackKey } from './types';
import { openNoteComposer, useNow } from './ui';

/**
 * The activity part of a profile card: their note (words + song, with a heart and comments) and the song they are listening to right
 * now (a big cover, with a heart). On YOUR card it is your note with a way to change it, or a button to add one.
 * Both rows only exist when there is something to show; with nothing, this renders nothing.
 */
export function PersonActivity({ userId, name, listening }: { userId: string; name: string; listening: Track | null | undefined }) {
  const note = useNote(userId);
  const me = useMyId();
  const now = useNow(30_000);
  const mine = me !== null && canonicalId(userId) === me;
  const owner = canonicalId(userId) ?? userId;
  const live = parseTrack(listening);
  // the same song in their note and in "listening now" is one row, not two
  const dup = !!live && !!note?.track && trackKey(note.track) === trackKey(live);

  return (
    <>
      {note && (
        <div className="mt-3 rounded-lg border bg-muted/40 p-2.5" data-testid="note-row">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-subtle-foreground">
            <span>Note · {relativeTime(note.createdAt, now)}</span>
            {mine && <span className="normal-case tracking-normal">{timeLeft(note.expiresAt, now)}</span>}
          </div>
          <NoteContent note={note} />
          {mine && (
            <Button variant="ghost" size="xs" className="mt-1.5 -ml-1" onClick={openNoteComposer}>
              <Pencil aria-hidden="true" /> Edit note
            </Button>
          )}
          <ReactionBar
            compact
            className="mt-1.5 border-t border-border/60 pt-1.5"
            subject={refOfNote(note)}
            context={contextOfNote(note)}
            ownerName={name}
            what={mine ? 'your note' : `${name}’s note`}
          />
        </div>
      )}
      {mine && !note && (
        <Button variant="soft" size="sm" className="mt-3 w-full" onClick={openNoteComposer}>
          <Plus aria-hidden="true" /> Add a note
        </Button>
      )}
      {live && !dup && !mine && (
        <ListeningRow
          track={live}
          className="mt-3"
          actions={
            <ReactionBar
              compact
              subject={refOfListening(owner, live)}
              context={contextOfSong(live)}
              ownerName={name}
              what={`${name}’s song`}
              className="w-full"
            />
          }
        />
      )}
      {live && dup && !mine && <p className="mt-2 text-[11px] text-subtle-foreground">Listening to it right now.</p>}
    </>
  );
}
