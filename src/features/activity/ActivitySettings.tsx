import { Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Segmented } from '@/components/ui';
import { SettingsRow } from '@/features/settings/ui';
import { notify } from '@/lib/toast';
import { selectSignedIn, useAuthStore } from '@/store/useAuthStore';
import { explainError, snippet, timeLeft } from './describe';
import { useActivityStore } from './hooks';
import { VISIBILITY_OPTIONS } from './NoteComposer';
import { bubbleText } from './NoteView';
import { NOTE_TTL_HOURS, type Visibility } from './types';
import { openNoteComposer, useNow } from './ui';

const NOTES_NOTE: Record<Visibility, string> = {
  off: 'Nobody sees your notes, and you can’t post one. Turning this off also removes your current note.',
  communities: 'People who share a community with you see your notes — on your avatar, your profile card and Home.',
  everyone: 'Any pact user can see your notes (only people who share a community with you will see your name).',
};

/**
 * The "Notes" controls, as two rows of the Profile section (right under Now playing): who may see your notes, and your current note
 * (with a button to add or change it). When the database update behind notes hasn't been applied, they say so instead of failing.
 */
export function ActivitySettings() {
  const signedIn = useAuthStore(selectSignedIn);
  const mine = useActivityStore((s) => s.mine);
  const now = useNow(60_000);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (signedIn) void useActivityStore.getState().loadMine();
  }, [signedIn]);

  const visibility = mine.visibility ?? 'communities';
  const change = async (v: Visibility) => {
    setBusy(true);
    try {
      await useActivityStore.getState().setVisibility(v);
    } catch (err) {
      notify.error('Couldn’t change that', explainError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsRow
        label="Who can see my notes"
        description={
          mine.unavailable
            ? 'Notes aren’t available on this server yet — the database update that adds them hasn’t been applied. Nothing is lost; they appear here once it is.'
            : !signedIn
              ? 'Sign in to share a note.'
              : mine.visibility === null && !mine.loaded
                ? 'Loading…'
                : NOTES_NOTE[visibility]
        }
      >
        <Segmented
          size="sm"
          aria-label="Who can see my notes"
          value={visibility}
          disabled={!signedIn || mine.unavailable || busy}
          onValueChange={(v) => void change(v)}
          options={VISIBILITY_OPTIONS}
        />
      </SettingsRow>
      <SettingsRow
        label="Your note"
        description={
          mine.note
            ? `“${snippet(bubbleText(mine.note), 60)}” · ${timeLeft(mine.note.expiresAt, now)}`
            : `A line and a song that disappear after ${NOTE_TTL_HOURS} hours, like a sticky note on your avatar.`
        }
      >
        <Button variant="outline" size="sm" disabled={!signedIn || mine.unavailable} onClick={openNoteComposer}>
          {mine.note ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />}
          {mine.note ? 'Edit note' : 'Add note'}
        </Button>
      </SettingsRow>
    </>
  );
}
