import { confirm } from '@/components/ui';
import { drainNotes } from '@/features/notes/sync/engine';
import { SYNC_STATE_KEY } from '@/features/notes/sync/model';
import { signOut } from '@/lib/supabase/auth';
import { notify } from '@/lib/toast';

/**
 * Sign out without losing work: first let any pending note changes upload; if some can't (offline), say so and let the
 * person choose. Notes are then removed from this device (they're safe in the account), and the page reloads clean.
 */
export async function requestSignOut(): Promise<void> {
  const pending = await drainNotes(5000);
  const ok = await confirm({
    title: 'Sign out of pact?',
    description:
      pending > 0
        ? `${pending} recent note change${pending === 1 ? '' : 's'} couldn’t be saved to your account yet and will be lost. Stay signed in until you’re back online to keep them.`
        : 'Your notes are saved in your account and will be here when you sign back in. Tasks, timer history and chats are stored only on this device for now and stay put.',
    confirmLabel: 'Sign out',
    destructive: pending > 0,
  });
  if (!ok) return;
  try {
    await signOut();
  } catch {
    notify.error('Couldn’t sign out', 'Check your connection and try again.');
    return;
  }
  try {
    localStorage.removeItem('pact-notes');
    localStorage.removeItem(SYNC_STATE_KEY);
  } catch {
    /* ignore */
  }
  window.location.reload();
}
