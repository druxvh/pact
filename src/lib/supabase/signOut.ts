import { confirm } from '@/components/ui';
import { drainNotes, haltNotesSync, useNotesSync } from '@/features/notes/sync/engine';
import { SYNC_STATE_KEY } from '@/features/notes/sync/model';
import { createSnapshot } from '@/lib/backup/snapshots';
import { freezePersistence } from '@/lib/persist';
import { signOut } from '@/lib/supabase/auth';
import { notify } from '@/lib/toast';

/**
 * Sign out without losing work: first let any pending note changes upload; if some can't (offline), say so and let the
 * person choose. A snapshot of what's on the device is kept first (it stays in Settings → Data safety). Then the session
 * is ended — everywhere when online — notes are removed from this device (they're safe in the account) and the page
 * reloads clean. If the session can't be ended the notes are left alone: never half signed-in with an empty notes list.
 */
export async function requestSignOut(): Promise<void> {
  const pending = await drainNotes(5000);
  const stuck = useNotesSync.getState().localOnly.length;
  const lines = [
    pending > 0
      ? `${pending} recent note change${pending === 1 ? '' : 's'} couldn’t be saved to your account yet and will be lost. Stay signed in until you’re back online to keep them.`
      : 'Your notes are saved in your account and will be here when you sign back in. Tasks, timer history and chats are stored only on this device for now and stay put.',
  ];
  if (stuck > 0) {
    lines.push(
      `${stuck} ${stuck === 1 ? 'item is' : 'items are'} too large to sync and ${stuck === 1 ? 'exists' : 'exist'} only on this device — signing out removes ${stuck === 1 ? 'it' : 'them'} from here (a snapshot is kept in Settings → Data safety).`,
    );
  }
  const ok = await confirm({
    title: 'Sign out of pact?',
    description: lines.join(' '),
    confirmLabel: 'Sign out',
    destructive: pending > 0 || stuck > 0,
  });
  if (!ok) return;

  // A safety net for anything that existed only here. Best effort — it must never block signing out.
  await createSnapshot({ kind: 'safety', label: 'Before sign-out' }).catch(() => null);

  const outcome = await signOut();
  if (!outcome.signedOutHere) {
    notify.error('Couldn’t sign out', 'Your session is still active, and your notes were left as they are. Try again.');
    return;
  }

  // Stop the engine and every store from writing, then clear this account's notes and bookkeeping.
  haltNotesSync();
  freezePersistence();
  try {
    localStorage.removeItem('pact-notes');
    localStorage.removeItem(SYNC_STATE_KEY);
  } catch {
    /* ignore */
  }
  if (!outcome.revokedEverywhere) {
    notify.error('Signed out on this device only', 'We couldn’t reach the server to sign out your other devices. Sign in and out again once you’re online.');
  }
  window.setTimeout(() => window.location.reload(), outcome.revokedEverywhere ? 0 : 2200);
}
