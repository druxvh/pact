import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { getAuthRedirectUrl, isExtension, launchAuthFlow } from '@/lib/ext';
import { supabase } from '@/lib/supabase/client';
import { bindTab, claimLocalData, startAccountWatch, tabOwner } from '@/lib/supabase/owner';
import { removeStoredSession, type StoredSession, storedSession } from '@/lib/supabase/stored';
import { type AuthProvider, type AuthUser, useAuthStore } from '@/store/useAuthStore';

const toUser = (session: Session): AuthUser => {
  const u = session.user;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    id: u.id,
    email: u.email ?? null,
    provider: str(u.app_metadata?.provider),
    name: str(meta.full_name) ?? str(meta.name) ?? str(meta.user_name),
  };
};

const fromStored = (s: StoredSession): AuthUser => ({ id: s.userId, email: s.email, provider: s.provider, name: s.name });

const setGuest = () => useAuthStore.setState({ status: 'guest', user: null, offline: false });

/**
 * Make `user` the signed-in account of this tab — after making sure this device's data is theirs. If it belonged to
 * someone else (or this tab's memory does), nothing is shown to the new account: persistence is frozen, the old
 * data is wiped by whichever tab noticed first, and the page reloads.
 */
async function adopt(user: AuthUser, offline: boolean): Promise<void> {
  const clean = await claimLocalData(user.id, tabOwner());
  if (!clean) {
    window.location.reload();
    return;
  }
  useAuthStore.setState({ status: 'signedIn', user, error: null, offline });
}

async function applySession(session: Session | null): Promise<void> {
  if (!session) {
    setGuest();
    return;
  }
  await adopt(toUser(session), false);
}

export type InitialSession = { kind: 'session'; session: Session } | { kind: 'offline'; user: AuthUser } | { kind: 'guest' };

/**
 * What to do with the answer to "is there a session?" at startup.
 *
 * `getSession()` refreshes an expired access token over the network (they last an hour). With no connection that
 * fails, and the session comes back `null` even though a perfectly good one is stored — which used to lock the person
 * out of every signed-in section while offline. A stored session with a refresh token, when the failure is "can't
 * reach the server" (or we were offline / it timed out), opens the app in offline mode instead. A *rejected* session
 * (revoked, invalid) is gone from storage already and correctly lands on guest.
 */
export function resolveInitialSession(input: {
  session: Session | null;
  error: unknown;
  stored: StoredSession | null;
  online: boolean;
  timedOut?: boolean;
}): InitialSession {
  if (input.session) return { kind: 'session', session: input.session };
  const { stored } = input;
  if (stored?.hasRefreshToken && (input.timedOut || !input.online || isAuthRetryableFetchError(input.error)))
    return { kind: 'offline', user: fromStored(stored) };
  return { kind: 'guest' };
}

const START_TIMEOUT_MS = 4000;

async function settleInitial(result: { session: Session | null; error: unknown } | 'timeout'): Promise<void> {
  const decision = resolveInitialSession({
    session: result === 'timeout' ? null : result.session,
    error: result === 'timeout' ? null : result.error,
    stored: storedSession(),
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    timedOut: result === 'timeout',
  });
  if (decision.kind === 'session') await applySession(decision.session);
  else if (decision.kind === 'offline') await adopt(decision.user, true);
  else setGuest();
}

let started = false;

/** Ask the server whether the stored session still works (the network came back, or the first check timed out). */
async function revalidate(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase.auth.getSession();
  if (data.session) await applySession(data.session);
  else if (!isAuthRetryableFetchError(error) && !storedSession()) setGuest();
}

/** Restore the session and follow sign-ins/outs (including from other tabs). Call once at startup. */
export async function startAuth(): Promise<void> {
  if (started || !supabase) return;
  started = true;
  bindTab(); // whose data did this tab's stores just load?
  startAccountWatch({
    onSessionRemoved: () => {
      if (useAuthStore.getState().status !== 'guest') setGuest();
    },
  });
  // supabase-js warns against awaiting other client calls inside this callback (it holds an internal lock), so defer.
  supabase.auth.onAuthStateChange((event, session) => {
    // The initial answer comes from getSession() below. (An offline start reports a `null` session here that is *not* a sign-out.)
    if (event === 'INITIAL_SESSION') return;
    if (!session && event !== 'SIGNED_OUT') return;
    window.setTimeout(() => void applySession(session), 0);
  });
  window.addEventListener('online', () => {
    if (useAuthStore.getState().offline) void revalidate();
  });

  const pending = supabase.auth.getSession();
  let timer: number | undefined;
  const first = await Promise.race([pending, new Promise<'timeout'>((resolve) => (timer = window.setTimeout(() => resolve('timeout'), START_TIMEOUT_MS)))]);
  window.clearTimeout(timer);
  if (first === 'timeout') {
    // The network is stalling: open from the stored session now and let the real answer replace it when it lands.
    await settleInitial('timeout');
    void pending.then(({ data }) => (data.session ? applySession(data.session) : undefined)).catch(() => {});
    return;
  }
  await settleInitial({ session: first.data.session, error: first.error });
}

const PROVIDER_LABEL: Record<AuthProvider, string> = { github: 'GitHub', google: 'Google' };

/** Friendlier text for the failures people actually hit. */
function explain(err: unknown, redirectTo: string | null): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/cancel|closed|did not approve|user denied/i.test(msg)) return 'Sign-in was cancelled.';
  if (/redirect|not allowed|invalid.*url/i.test(msg)) {
    return `The provider rejected the redirect. Add ${redirectTo ?? 'this page’s URL'} to Redirect URLs in your Supabase project (Authentication → URL Configuration).`;
  }
  return msg || 'Something went wrong signing in.';
}

/** The URL that must be on the Supabase "Redirect URLs" allow-list for sign-in to work here. */
export function authRedirectUrl(): string {
  return (isExtension ? getAuthRedirectUrl() : null) ?? `${window.location.origin}${window.location.pathname}`;
}

export async function signInWith(provider: AuthProvider): Promise<void> {
  if (!supabase) {
    useAuthStore.setState({ error: 'The backend isn’t configured for this build.' });
    return;
  }
  const redirectTo = authRedirectUrl();
  useAuthStore.setState({ signingIn: provider, error: null });
  try {
    if (isExtension) {
      const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } });
      if (error || !data.url) throw error ?? new Error('No sign-in URL was returned.');
      const back = new URL(await launchAuthFlow(data.url));
      const failure = back.searchParams.get('error_description') ?? back.searchParams.get('error');
      if (failure) throw new Error(failure.replace(/\+/g, ' '));
      const code = back.searchParams.get('code');
      if (!code) throw new Error('The provider did not return a sign-in code.');
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) throw exchangeError;
    } else {
      // Dev web page: a normal redirect round-trip (supabase-js reads ?code= when we come back).
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
      if (error) throw error;
    }
  } catch (err) {
    useAuthStore.setState({ error: explain(err, redirectTo) });
  } finally {
    useAuthStore.setState({ signingIn: null });
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normalizeEmail = (v: string) => v.trim().toLowerCase();
export const isEmail = (v: string) => v.length <= 254 && EMAIL_RE.test(normalizeEmail(v));
/** Supabase codes are 6 digits by default (up to 10 if the project is configured that way). */
export const normalizeCode = (v: string) => v.replace(/\s+/g, '');
export const isCode = (v: string) => /^\d{6,10}$/.test(normalizeCode(v));

function explainEmail(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/rate limit|too many|seconds/i.test(msg)) return 'Too many attempts — wait a minute and try again.';
  if (/expired|invalid/i.test(msg)) return 'That code is wrong or has expired. Check the newest email, or send a new code.';
  if (/signups? not allowed|disabled/i.test(msg)) return 'Email sign-in is turned off for this project.';
  return msg || 'Something went wrong.';
}

/** Email a one-time code (creates the account on first use). Returns an error message, or null on success. */
export async function sendEmailCode(email: string): Promise<string | null> {
  if (!supabase) return 'The backend isn’t configured for this build.';
  if (!isEmail(email)) return 'Enter a valid email address.';
  const { error } = await supabase.auth.signInWithOtp({ email: normalizeEmail(email), options: { shouldCreateUser: true } });
  return error ? explainEmail(error) : null;
}

/** Exchange the emailed code for a session. Returns an error message, or null on success. */
export async function verifyEmailCode(email: string, code: string): Promise<string | null> {
  if (!supabase) return 'The backend isn’t configured for this build.';
  if (!isCode(code)) return 'Enter the code from the email (digits only).';
  const { error } = await supabase.auth.verifyOtp({ email: normalizeEmail(email), token: normalizeCode(code), type: 'email' });
  return error ? explainEmail(error) : null;
}

export const providerLabel = (p: AuthProvider) => PROVIDER_LABEL[p];

export type SignOutOutcome = {
  /** This device is signed out (the stored session is gone and the app is in guest state). */
  signedOutHere: boolean;
  /** Every session of the account was ended on the server (needs a connection). */
  revokedEverywhere: boolean;
  /** Why the server-side part failed, if it did. */
  message?: string;
};

/**
 * Sign out, robustly. Callers that care about unsynced changes go through `requestSignOut`.
 *
 * supabase-js *returns* errors from `signOut()` instead of throwing them, so the old `await signOut()` + try/catch
 * could never notice a failure: offline, the global sign-out is refused *before* the session is removed, the page
 * reloaded still signed in — and with its notes already wiped. Now:
 *  1. Online → `scope: 'global'`, which ends this account's sessions everywhere (a stolen refresh token dies too).
 *  2. If that fails (offline, server error) → `scope: 'local'`, which removes the stored session *before* it contacts
 *     the server, so it can't be blocked by the network.
 *  3. Whatever happened, make sure the session is really gone from storage and the app is in guest state — never
 *     half signed-in — and report what did and didn't happen so the UI can say so.
 */
export async function signOut(): Promise<SignOutOutcome> {
  if (!supabase) return { signedOutHere: true, revokedEverywhere: true };
  let revokedEverywhere = false;
  let message: string | undefined;
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    try {
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) message = error.message;
      else revokedEverywhere = true;
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
  } else {
    message = 'You’re offline.';
  }
  if (!revokedEverywhere) {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      /* handled below: the stored session is removed by hand */
    }
  }
  if (storedSession()) removeStoredSession();
  const signedOutHere = storedSession() === null;
  if (signedOutHere) setGuest();
  return { signedOutHere, revokedEverywhere, ...(message ? { message } : null) };
}
