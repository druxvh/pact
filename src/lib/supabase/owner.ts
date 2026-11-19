/**
 * Whose data is on this device?
 *
 * Until now everything lived locally, so the first account to sign in simply *claims* it (and it syncs up). If a
 * *different* account signs in later, the leftovers belong to someone else — they must never be uploaded into, or
 * shown to, the new account. So we remember the owner and wipe the previous person's local data when it changes.
 *
 * The subtle part is several tabs. Each tab's stores hold whatever was on disk when *that tab* loaded. If tab B signs
 * in as a different account, it wipes the disk and claims it — but tab A is still holding the previous account's data
 * in memory, and its sign-in event arrives *after* the claim, so "the owner is already the new account" looks fine.
 * Tab A would then happily upload (or write back) the old account's notes under the new one. So every tab remembers
 * which account its own memory belongs to (`tabOwner`), compares against *that* — not just against the disk — and,
 * when the account changes underneath it, freezes persistence and reloads instead of carrying on.
 */
import { clearCaptures } from '@/features/camera/gallery';
import { clearBlobs } from '@/features/chat/idb';
import { clearSnapshots } from '@/lib/backup/db';
import { freezePersistence } from '@/lib/persist';
import { AUTH_STORAGE_KEY } from '@/lib/supabase/client';
import { parseStoredSession, storedSessionUserId } from '@/lib/supabase/stored';

export const OWNER_KEY = 'pact-local-owner';

/** Per-person data kept on this device. (Shortcuts, appearance and the theme are preferences of the *browser*, not the account.) */
const PERSONAL_KEYS = [
  'pact-user',
  'pact-notes',
  'pact-kanban',
  'pact-timer',
  'pact-chat',
  'pact-home-layout',
  'pact-main-focus',
  'pact-discover',
  'pact-discover-cache',
  'pact-capture',
  'pact-commands',
  'pact-camera',
  'pact-nowplaying', // who may see my track is the previous account's setting; detecting needs a fresh opt-in
  'pact-sync-notes',
] as const;

export function localOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function setOwner(userId: string) {
  try {
    localStorage.setItem(OWNER_KEY, userId);
  } catch {
    /* ignore */
  }
}

// ── which account does *this tab's memory* belong to ─────────────────────────

/** `undefined` until `bindTab()`: then the owner on disk when this tab started (null = nobody had claimed it yet). */
let loadedFor: string | null | undefined;

/** Call once at startup, before any sign-in is processed: the stores have just hydrated from disk. */
export function bindTab(): string | null {
  loadedFor = localOwner();
  return loadedFor;
}

export const tabOwner = (): string | null => (loadedFor === undefined ? localOwner() : loadedFor);

/** Test helper. */
export function resetTabBinding(): void {
  loadedFor = undefined;
}

/**
 * Is `userId` the signed-in account (per the session on disk) *and* the owner of this device's data, right now?
 * Cheap and synchronous — the sync engine calls it before every request and merge.
 */
export function isAccountCurrent(userId: string): boolean {
  return localOwner() === userId && storedSessionUserId() === userId;
}

// ── wiping ───────────────────────────────────────────────────────────────────

/** Remove one person's data from this device — including their automatic backups. */
export async function wipePersonalData(): Promise<void> {
  try {
    for (const k of PERSONAL_KEYS) localStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
  await Promise.all([clearBlobs().catch(() => {}), clearSnapshots().catch(() => {}), clearCaptures()]);
}

/**
 * Record `userId` as the owner of this device's data. Returns `false` if the data (on disk or in this tab's memory)
 * belonged to someone else — in which case the page must reload so every store starts from a clean slate.
 *
 * `loaded` is whose data this tab's stores hold (defaults to the tab's binding). The first tab to notice a change of
 * account wipes the disk; later tabs see the new owner and only reload, so they can't destroy the new account's data.
 */
export async function claimLocalData(userId: string, loaded: string | null = tabOwner()): Promise<boolean> {
  const owner = localOwner();
  const foreignMemory = loaded !== null && loaded !== userId;
  if (foreignMemory || (owner && owner !== userId)) {
    freezePersistence(); // the old in-memory data must not be written back, over or into the new account's
    if (owner !== userId) {
      await wipePersonalData();
      setOwner(userId);
    }
    return false;
  }
  if (!owner) setOwner(userId);
  loadedFor = userId;
  return true;
}

// ── reacting to other tabs ───────────────────────────────────────────────────

/** Swappable so tests don't try to reload happy-dom. */
export const accountGuard = { reload: (): void => window.location.reload() };

function foreignAccount() {
  freezePersistence();
  accountGuard.reload();
}

let watching = false;

/**
 * Follow the `storage` event: another tab claimed the device for a different account, or changed the stored session.
 * `onSessionRemoved` fires when the session disappeared (signed out in another tab, even a sign-out that had to remove
 * it by hand and therefore sent no broadcast).
 */
export function startAccountWatch(opts: { onSessionRemoved: () => void }): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== window.localStorage) return;
    if (e.key === OWNER_KEY) {
      if (!e.newValue) return;
      const mine = tabOwner();
      if (mine === null)
        loadedFor = e.newValue; // an unclaimed tab simply joins the account that claimed the data
      else if (e.newValue !== mine) foreignAccount();
    } else if (e.key === AUTH_STORAGE_KEY) {
      const next = parseStoredSession(e.newValue);
      if (!next) opts.onSessionRemoved();
      else {
        const mine = tabOwner();
        if (mine !== null && next.userId !== mine) foreignAccount();
      }
    }
  });
}
