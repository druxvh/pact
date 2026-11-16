import type { Session } from '@supabase/supabase-js';
import { getAuthRedirectUrl, isExtension, launchAuthFlow } from '@/lib/ext';
import { supabase } from '@/lib/supabase/client';
import { claimLocalData } from '@/lib/supabase/owner';
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

async function applySession(session: Session | null): Promise<void> {
  if (!session) {
    useAuthStore.setState({ status: 'guest', user: null });
    return;
  }
  const clean = await claimLocalData(session.user.id);
  if (!clean) {
    // Another person's data was on this device and has been removed; start every store fresh.
    window.location.reload();
    return;
  }
  useAuthStore.setState({ status: 'signedIn', user: toUser(session), error: null });
}

let started = false;

/** Restore the session and follow sign-ins/outs (including from other tabs). Call once at startup. */
export async function startAuth(): Promise<void> {
  if (started || !supabase) return;
  started = true;
  // supabase-js warns against awaiting other client calls inside this callback (it holds an internal lock), so defer.
  supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => void applySession(session), 0);
  });
  const { data } = await supabase.auth.getSession();
  await applySession(data.session);
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

export const providerLabel = (p: AuthProvider) => PROVIDER_LABEL[p];

/** Plain sign-out (callers that care about unsynced changes go through `requestSignOut`). */
export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}
