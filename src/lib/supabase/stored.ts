/**
 * Reading the session supabase-js keeps in localStorage — without asking the network.
 *
 * Two jobs: (1) tell which account is signed in right now in *any* tab (used to re-check ownership right before
 * uploading), and (2) let the app open in offline mode when the stored session can't be validated because there is
 * no connection (the data is local-first; sign-in only gates what the person sees, not what is on the disk).
 * The storage is untrusted input: every field is type-checked.
 */
import { AUTH_STORAGE_KEY } from '@/lib/supabase/client';

export type StoredSession = {
  userId: string;
  email: string | null;
  provider: string | null;
  name: string | null;
  /** The refresh token is what keeps a session alive; the access token expiring (hourly) says nothing. */
  hasRefreshToken: boolean;
  /** Epoch seconds the access token expires, if recorded. */
  expiresAt: number | null;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Parse the raw value stored under the auth key. Returns null for anything that isn't a usable session. */
export function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw || raw.length > 200_000) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  const user = s.user && typeof s.user === 'object' ? (s.user as Record<string, unknown>) : null;
  const userId = user ? str(user.id) : null;
  if (!user || !userId) return null;
  const meta = user.user_metadata && typeof user.user_metadata === 'object' ? (user.user_metadata as Record<string, unknown>) : {};
  const app = user.app_metadata && typeof user.app_metadata === 'object' ? (user.app_metadata as Record<string, unknown>) : {};
  return {
    userId,
    email: str(user.email),
    provider: str(app.provider),
    name: str(meta.full_name) ?? str(meta.name) ?? str(meta.user_name),
    hasRefreshToken: typeof s.refresh_token === 'string' && s.refresh_token.length > 0,
    expiresAt: typeof s.expires_at === 'number' && Number.isFinite(s.expires_at) ? s.expires_at : null,
  };
}

export function storedSession(): StoredSession | null {
  try {
    return parseStoredSession(localStorage.getItem(AUTH_STORAGE_KEY));
  } catch {
    return null;
  }
}

export const storedSessionUserId = (): string | null => storedSession()?.userId ?? null;

/** Remove the stored session (and PKCE verifier) — exactly what supabase-js does on sign-out, for when it can't. */
export function removeStoredSession(): void {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`);
    localStorage.removeItem(`${AUTH_STORAGE_KEY}-user`);
  } catch {
    /* storage unavailable */
  }
}
