import { Clock, Headphones, Trash2, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button, confirm, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Select } from '@/components/ui';
import { useLocalNow } from '@/features/nowplaying/localNow';
import { sourceLabel } from '@/features/nowplaying/sources';
import { TrackArt } from '@/features/nowplaying/TrackArt';
import { parseTrack, type Track } from '@/features/nowplaying/track';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import { selectSignedIn, useAuthStore } from '@/store/useAuthStore';
import { explainError, timeLeft } from './describe';
import { useActivityStore } from './hooks';
import { NOTE_MAX, NOTE_TTL_HOURS, type Visibility } from './types';
import { closeNoteComposer, useNoteComposer, useNow } from './ui';

export const VISIBILITY_OPTIONS: ReadonlyArray<{ value: Visibility; label: string }> = [
  { value: 'off', label: 'Nobody' },
  { value: 'communities', label: 'My communities' },
  { value: 'everyone', label: 'Everyone' },
];

const sameSong = (a: Track, b: Track) => a.source === b.source && a.title === b.title && a.artist === b.artist;

/** A song you can pin: cover, title, artist · player — one tap to choose it. */
function SongChoice({ track, label, selected, onPick }: { track: Track; label?: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg border p-1.5 text-left transition-colors hover:bg-accent',
        selected ? 'border-brand/60 bg-brand-soft' : 'bg-muted/30',
      )}
    >
      <TrackArt track={track} size={36} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-tight">{track.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {track.artist ? `${track.artist} · ` : ''}
          {sourceLabel(track.source)}
        </span>
      </span>
      {label && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-brand-text">{label}</span>}
    </button>
  );
}

function ComposerForm() {
  const mine = useActivityStore((s) => s.mine);
  const recent = useActivityStore((s) => s.recent);
  const local = useLocalNow();
  const now = useNow(30_000);
  const fieldId = useId();
  const [text, setText] = useState(mine.note?.text ?? '');
  const [song, setSong] = useState<Track | null>(mine.note?.track ?? null);
  const [visibility, setVisibility] = useState<Visibility>(mine.visibility && mine.visibility !== 'off' ? mine.visibility : 'communities');
  const [busy, setBusy] = useState(false);

  // The note and the setting may still be on their way when the dialog opens.
  useEffect(() => {
    void useActivityStore.getState().loadMine();
  }, []);
  const loaded = mine.loaded;
  useEffect(() => {
    if (!loaded) return;
    const s = useActivityStore.getState().mine;
    setText((cur) => (cur === '' ? (s.note?.text ?? '') : cur));
    setSong((cur) => cur ?? s.note?.track ?? null);
    if (s.visibility && s.visibility !== 'off') setVisibility(s.visibility);
  }, [loaded]);

  const playing = local?.playing ? parseTrack(local.track) : null;
  // current first, then what played lately; no repeats
  const choices = [...(playing ? [playing] : []), ...recent.filter((t) => !playing || !sameSong(t, playing))].slice(0, 4);
  const clean = text.replace(/\s+/g, ' ').trim();
  const canShare = (clean.length > 0 || song !== null) && clean.length <= NOTE_MAX && !busy;
  const left = mine.note ? timeLeft(mine.note.expiresAt, now) : null;

  const share = async () => {
    if (!canShare) return;
    setBusy(true);
    try {
      await useActivityStore.getState().postNote({ text: clean, track: song, visibility });
      notify.success('Note shared', `Visible for ${NOTE_TTL_HOURS} hours.`);
      closeNoteComposer();
    } catch (err) {
      notify.error('Couldn’t share your note', explainError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !(await confirm({
        title: 'Delete your note?',
        description: 'It disappears for everyone, along with its hearts and comments.',
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await useActivityStore.getState().deleteNote();
      notify.success('Note deleted');
      closeNoteComposer();
    } catch (err) {
      notify.error('Couldn’t delete your note', explainError(err));
    } finally {
      setBusy(false);
    }
  };

  if (mine.unavailable) {
    return (
      <>
        <DialogBody>
          <p role="status" className="rounded-lg border bg-muted/40 p-3 text-[13px] leading-relaxed text-muted-foreground">
            Notes aren’t available on this server yet. The database update that adds them hasn’t been applied — once it is, you’ll be able to share a line and a
            song here for 24 hours.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={closeNoteComposer}>Close</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogBody className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <label htmlFor={fieldId} className="text-xs font-medium text-muted-foreground">
              What’s on your mind?
            </label>
            <span className={cn('text-[11px] tabular-nums', text.length >= NOTE_MAX ? 'text-warning-text' : 'text-subtle-foreground')} aria-live="polite">
              {text.length}/{NOTE_MAX}
            </span>
          </div>
          <Input
            id={fieldId}
            value={text}
            maxLength={NOTE_MAX}
            placeholder="Heads down until 3, then pizza"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void share();
              }
            }}
          />
        </div>

        <div>
          <p className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
            Add a song
            {song && (
              <button
                type="button"
                onClick={() => setSong(null)}
                className="inline-flex items-center gap-1 rounded-sm text-[11px] text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" aria-hidden="true" /> Remove
              </button>
            )}
          </p>
          {song && !choices.some((c) => sameSong(c, song)) && (
            <div className="mb-1.5">
              <SongChoice track={song} label="In your note" selected onPick={() => setSong(null)} />
            </div>
          )}
          {choices.length > 0 ? (
            <ul className="space-y-1.5">
              {choices.map((t, i) => (
                <li key={`${t.source}|${t.title}|${t.artist}`}>
                  <SongChoice
                    track={t}
                    label={i === 0 && playing ? 'Playing now' : undefined}
                    selected={song !== null && sameSong(song, t)}
                    onPick={() => setSong(song !== null && sameSong(song, t) ? null : t)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            !song && (
              <p className="flex items-start gap-2 rounded-lg border border-dashed p-2.5 text-xs leading-snug text-muted-foreground">
                <Headphones className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                Play something in a music tab and it shows up here to pin. (Turn on “Detect music” in Settings → Profile.)
              </p>
            )
          )}
        </div>

        <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
          <p className="text-xs font-medium text-muted-foreground">Who can see it</p>
          <Select size="sm" aria-label="Who can see your note" value={visibility} onValueChange={setVisibility} options={VISIBILITY_OPTIONS} className="w-44" />
          <p className="col-span-2 text-[11px] leading-snug text-subtle-foreground">
            {visibility === 'off'
              ? 'Choose who can see your notes to share one. This is your Notes setting (also in Settings → Profile).'
              : visibility === 'communities'
                ? 'People who share a community with you. This is your Notes setting for every note.'
                : 'Any pact user (only people who share a community with you will see your name). This is your Notes setting for every note.'}
          </p>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3.5 shrink-0" aria-hidden="true" />
          {left
            ? `Your current note has ${left}. Sharing replaces it and starts a fresh ${NOTE_TTL_HOURS} hours.`
            : `Visible for ${NOTE_TTL_HOURS} hours, then it disappears.`}
        </p>
      </DialogBody>
      <DialogFooter className="justify-between">
        {mine.note ? (
          <Button variant="danger" size="sm" disabled={busy} onClick={() => void remove()}>
            <Trash2 aria-hidden="true" /> Delete note
          </Button>
        ) : (
          <span />
        )}
        <span className="flex items-center gap-2">
          <Button variant="ghost" onClick={closeNoteComposer}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!canShare || visibility === 'off'} onClick={() => void share()}>
            Share note
          </Button>
        </span>
      </DialogFooter>
    </>
  );
}

/** The note composer — one dialog for the whole app (mounted in the shell), opened from the avatar menu, your profile card, Settings and Home. */
export function NoteComposerHost() {
  const open = useNoteComposer((s) => s.open);
  const signedIn = useAuthStore(selectSignedIn);
  return (
    <Dialog open={open && signedIn} onOpenChange={(o) => !o && closeNoteComposer()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Your note</DialogTitle>
          <DialogDescription>A short line for the people you share with — like a sticky note on your avatar.</DialogDescription>
        </DialogHeader>
        {/* remounted on each open, so it starts from the current note */}
        {open && <ComposerForm />}
      </DialogContent>
    </Dialog>
  );
}
