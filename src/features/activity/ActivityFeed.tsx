import { Activity, Pencil, Plus } from 'lucide-react';
import { type ReactNode, useEffect, useMemo } from 'react';
import { Button, Skeleton } from '@/components/ui';
import { useNowPlayingStore } from '@/features/nowplaying/hooks';
import { ListeningRow } from '@/features/nowplaying/ListeningRow';
import { PersonAvatar } from '@/features/nowplaying/PersonAvatar';
import { TTL_MS } from '@/features/nowplaying/store';
import type { Track } from '@/features/nowplaying/track';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { notify } from '@/lib/toast';
import { contextOfNote, contextOfSong, explainError, refOfListening, refOfNote, timeLeft } from './describe';
import { useActivityStore, useMyId } from './hooks';
import { NoteContent } from './NoteView';
import { canonicalId, usePerson, useResolvedOwners } from './people';
import { ReactionBar } from './ReactionBar';
import { type Note, trackKey } from './types';
import { openNoteComposer, useNow } from './ui';

/** How many of the people in my communities are followed for "listening now" at a time (the Now playing store allows 100 in all). */
const LISTENING_WATCH = 50;
const LISTENING_SHOWN = 20;

type Entry =
  | { kind: 'note'; key: string; at: string; ownerId: string; note: Note }
  | { kind: 'listening'; key: string; at: string; ownerId: string; track: Track };

/** Who is listening to something right now, among the people in my communities (the Now playing store does the work; this only follows them). */
function useListeningEntries(): Array<Extract<Entry, { kind: 'listening' }>> {
  const peers = useActivityStore((s) => s.peers);
  const rows = useNowPlayingStore((s) => s.rows);
  useEffect(() => {
    const stops = peers.slice(0, LISTENING_WATCH).map((id) => useNowPlayingStore.getState().watch(id));
    return () => {
      for (const stop of stops) stop();
    };
  }, [peers]);
  return useMemo(() => {
    const t = Date.now();
    const out: Array<Extract<Entry, { kind: 'listening' }>> = [];
    for (const id of peers) {
      const row = rows[id];
      if (!row || row.expiresAt <= t) continue;
      out.push({ kind: 'listening', key: `${id}|listening`, at: new Date(row.expiresAt - TTL_MS).toISOString(), ownerId: id, track: row.track });
    }
    // a stable order (by person), so the list doesn't shuffle every time someone's player reports again
    return out.sort((a, b) => a.ownerId.localeCompare(b.ownerId)).slice(0, LISTENING_SHOWN);
  }, [peers, rows]);
}

function Header({ ownerId, line, trailing }: { ownerId: string; line: ReactNode; trailing?: ReactNode }) {
  const person = usePerson(ownerId);
  const me = useMyId();
  const mine = me !== null && canonicalId(ownerId) === me;
  return (
    <header className="flex items-center gap-2.5">
      <PersonAvatar userId={ownerId} name={person.name} src={person.avatarUrl} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium leading-tight">
          {person.name}
          {mine && <span className="font-normal text-subtle-foreground"> (you)</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">{line}</p>
      </div>
      {trailing}
    </header>
  );
}

function NoteCard({ entry }: { entry: Extract<Entry, { kind: 'note' }> }) {
  const person = usePerson(entry.ownerId);
  const me = useMyId();
  const now = useNow(60_000);
  const mine = me !== null && canonicalId(entry.ownerId) === me;
  return (
    <article aria-label={`${mine ? 'Your' : `${person.name}’s`} note`} className="rounded-lg border bg-card p-4 text-card-foreground shadow-xs">
      <Header
        ownerId={entry.ownerId}
        line={`${relativeTime(entry.at, now)}${mine ? ` · ${timeLeft(entry.note.expiresAt, now)}` : ''}`}
        trailing={
          mine ? (
            <Button variant="ghost" size="xs" onClick={openNoteComposer}>
              <Pencil aria-hidden="true" /> Edit
            </Button>
          ) : null
        }
      />
      <NoteContent note={entry.note} size="lg" className="mt-3" />
      <ReactionBar
        className="mt-3 border-t pt-2"
        subject={refOfNote(entry.note)}
        context={contextOfNote(entry.note)}
        ownerName={person.name}
        what={mine ? 'your note' : `${person.name}’s note`}
      />
    </article>
  );
}

function SongCard({ entry }: { entry: Extract<Entry, { kind: 'listening' }> }) {
  const person = usePerson(entry.ownerId);
  return (
    <article aria-label={`${person.name} is listening to ${entry.track.title}`} className="rounded-lg border bg-card p-4 text-card-foreground shadow-xs">
      <Header ownerId={entry.ownerId} line="Listening now" />
      <ListeningRow track={entry.track} size="lg" className="mt-3" />
      <ReactionBar
        className="mt-3 border-t pt-2"
        subject={refOfListening(entry.ownerId, entry.track)}
        context={contextOfSong(entry.track)}
        ownerName={person.name}
        what={`${person.name}’s song`}
      />
    </article>
  );
}

function Skeletons() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading activity">
      {[0, 1, 2].map((i) => (
        <div key={i === 0 ? 'a' : i === 1 ? 'b' : 'c'} className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-10" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <Skeleton className="mt-3 h-4 w-2/3" />
          {i !== 1 && <Skeleton className="mt-3 h-[100px] w-full" />}
          <Skeleton className="mt-3 h-6 w-40" />
        </div>
      ))}
    </div>
  );
}

/**
 * The Activity section under Home's widgets: the notes of the people in your communities and what they are listening to right now —
 * each a card with a heart (and its count), comments under notes, and a private reply. Newest first, 40 notes at a time; it follows live
 * changes. Only shown to someone signed in (the caller checks), and only reads what the database lets this person see.
 */
export function ActivityFeed({ className }: { className?: string }) {
  const feed = useActivityStore((s) => s.feed);
  const status = useActivityStore((s) => s.feedStatus);
  const hasMore = useActivityStore((s) => s.hasMore);
  const loadingMore = useActivityStore((s) => s.loadingMore);
  const mine = useActivityStore((s) => s.mine);
  const me = useMyId();
  const live = useListeningEntries();

  // `status` is "idle" on arrival and again after an account change (the store forgets everything): either way, load.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `me` is the trigger, not a value the effect reads
  useEffect(() => {
    if (status === 'idle') void useActivityStore.getState().ensureFeed();
  }, [status, me]);

  const everyone = useMemo(() => {
    const notes: Entry[] = feed.flatMap((i): Entry[] =>
      i.kind === 'note' ? [{ kind: 'note', key: `${i.ref.ownerId}|${i.ref.key}`, at: i.at, ownerId: i.ref.ownerId, note: i.note }] : [],
    );
    // someone whose note already shows the same song doesn't also get a "listening now" card for it
    const noteSong = new Map(notes.flatMap((n) => (n.kind === 'note' && n.note.track ? [[n.ownerId, trackKey(n.note.track)] as const] : [])));
    const songs = live.filter((l) => noteSong.get(l.ownerId) !== trackKey(l.track));
    return [...songs, ...notes];
  }, [feed, live]);
  // A note from someone we can't name (a stranger — their profile isn't readable) is left out, never shown as "Unknown".
  const { known, pending } = useResolvedOwners(everyone.map((e) => e.ownerId));
  const entries = useMemo(() => everyone.filter((e) => known.has(e.ownerId)), [everyone, known]);
  const resolving = entries.length === 0 && everyone.length > 0 && pending;

  const hasMine = !!mine.note;
  const unavailable = status === 'unavailable' || mine.unavailable;

  return (
    <section aria-labelledby="home-activity-title" className={cn('w-full max-w-2xl', className)}>
      <header className="mb-3 flex items-center gap-2 px-1">
        <Activity className="size-4 shrink-0 text-brand-text" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="home-activity-title" className="text-sm font-semibold tracking-tight">
            Activity
          </h2>
          <p className="truncate text-xs text-muted-foreground">Notes and music from the people in your communities</p>
        </div>
        {!unavailable && (
          <Button variant={hasMine ? 'outline' : 'soft'} size="sm" onClick={openNoteComposer}>
            {hasMine ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {hasMine ? 'Edit note' : 'Add note'}
          </Button>
        )}
      </header>

      {unavailable ? (
        <p role="status" className="rounded-lg border border-dashed p-5 text-center text-[13px] text-muted-foreground">
          Notes, hearts and comments aren’t available on this server yet.
        </p>
      ) : ((status === 'idle' || status === 'loading') && entries.length === 0) || resolving ? (
        <Skeletons />
      ) : status === 'error' && entries.length === 0 ? (
        <div role="status" className="rounded-lg border border-dashed p-5 text-center">
          <p className="text-[13px] text-muted-foreground">Couldn’t load activity. Check your connection.</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void useActivityStore.getState().refreshFeed()}>
            Try again
          </Button>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center" data-empty="">
          <p className="text-sm font-medium">Nothing yet — add a note</p>
          <p className="mx-auto mt-1 max-w-xs text-[13px] text-muted-foreground">
            A line and a song for the people you share with. Their notes and what they’re listening to will show up here.
          </p>
          <Button variant="primary" size="sm" className="mt-3" onClick={openNoteComposer}>
            <Plus aria-hidden="true" /> Add note
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((e) => (e.kind === 'note' ? <NoteCard key={e.key} entry={e} /> : <SongCard key={e.key} entry={e} />))}
          {hasMore && (
            <div className="flex justify-center pt-1">
              <Button
                variant="outline"
                size="sm"
                loading={loadingMore}
                onClick={() =>
                  void useActivityStore
                    .getState()
                    .loadMoreFeed()
                    .catch((err) => notify.error('Couldn’t load more', explainError(err)))
                }
              >
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
