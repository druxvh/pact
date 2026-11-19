/** "Is this username free?" while you type — answered by the `username_available` database function. */
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { selectSignedIn, useAuthStore } from '@/store/useAuthStore';
import { validateUsername } from '@/store/useUserStore';

export type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'unknown';

/** true = free, false = taken, null = couldn't tell (offline, backend off) — in which case the server still enforces it on save. */
export async function isUsernameAvailable(username: string): Promise<boolean | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('username_available', { name: username });
  return error || typeof data !== 'boolean' ? null : data;
}

/**
 * Debounced availability for the (already normalised) `username`. Stays `idle` when there's nothing to ask: it's your
 * current name, it isn't valid yet, or you aren't signed in. While the answer is pending it says `checking`.
 */
export function useUsernameAvailability(username: string, current: string, delayMs = 450): UsernameStatus {
  const signedIn = useAuthStore(selectSignedIn);
  const askable = signedIn && !!supabase && username !== current && validateUsername(username) === null;
  const [state, setState] = useState<{ name: string; status: UsernameStatus }>({ name: '', status: 'idle' });

  useEffect(() => {
    if (!askable) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void isUsernameAvailable(username).then((ok) => {
        if (!cancelled) setState({ name: username, status: ok === null ? 'unknown' : ok ? 'available' : 'taken' });
      });
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [askable, username, delayMs]);

  if (!askable) return 'idle';
  return state.name === username ? state.status : 'checking';
}
