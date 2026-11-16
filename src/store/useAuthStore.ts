import { create } from 'zustand';
import { hasStoredSession, isBackendConfigured } from '@/lib/supabase/client';

export type AuthStatus = 'loading' | 'guest' | 'signedIn';
export type AuthProvider = 'github' | 'google';

export type AuthUser = {
  id: string;
  email: string | null;
  provider: string | null;
  /** Name the provider gave us — only used to suggest a display name, never for authorisation. */
  name: string | null;
};

type AuthState = {
  /** `loading` only while a stored session is being checked, so a signed-in user never sees the guest UI flash. */
  status: AuthStatus;
  user: AuthUser | null;
  /** The provider whose sign-in window is open right now. */
  signingIn: AuthProvider | null;
  error: string | null;
};

export const useAuthStore = create<AuthState>(() => ({
  status: !isBackendConfigured ? 'guest' : hasStoredSession() ? 'loading' : 'guest',
  user: null,
  signingIn: null,
  error: null,
}));

export const selectSignedIn = (s: AuthState) => s.status === 'signedIn';
