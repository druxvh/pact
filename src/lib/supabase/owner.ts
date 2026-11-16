/**
 * Whose data is on this device?
 *
 * Until now everything lived locally, so the first account to sign in simply *claims* it (and it syncs up). If a
 * *different* account signs in later, the leftovers belong to someone else — they must never be uploaded into, or
 * shown to, the new account. So we remember the owner and wipe the previous person's local data when it changes.
 */
import { clearBlobs } from '@/features/chat/idb';

const OWNER_KEY = 'pact-local-owner';

/** Per-person data kept on this device. (Shortcuts, appearance and the theme are preferences of the *browser*, not the account.) */
const PERSONAL_KEYS = ['pact-user', 'pact-notes', 'pact-kanban', 'pact-timer', 'pact-chat', 'pact-home-layout', 'pact-sync-notes'] as const;

export function localOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

/** Remove one person's data from this device. */
export async function wipePersonalData(): Promise<void> {
  try {
    for (const k of PERSONAL_KEYS) localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
  await clearBlobs().catch(() => {});
}

/**
 * Record `userId` as the owner of this device's data. Returns `false` if it belonged to someone else — in which case
 * it has been wiped and the page must reload so every store starts from a clean slate.
 */
export async function claimLocalData(userId: string): Promise<boolean> {
  const owner = localOwner();
  if (owner && owner !== userId) {
    await wipePersonalData();
    try {
      localStorage.setItem(OWNER_KEY, userId);
    } catch {
      /* ignore */
    }
    return false;
  }
  if (!owner) {
    try {
      localStorage.setItem(OWNER_KEY, userId);
    } catch {
      /* ignore */
    }
  }
  return true;
}
