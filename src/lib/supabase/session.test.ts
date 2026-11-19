import { AuthApiError, AuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { resolveInitialSession } from './auth';
import type { StoredSession } from './stored';

const stored: StoredSession = { userId: 'u1', email: 'a@b.co', provider: 'github', name: 'Ada', hasRefreshToken: true, expiresAt: 1 };
const live = { user: { id: 'u1' } } as unknown as Session;
const offlineUser = { id: 'u1', email: 'a@b.co', provider: 'github', name: 'Ada' };

describe('opening the app offline', () => {
  it('a session the server confirmed is used as is', () => {
    expect(resolveInitialSession({ session: live, error: null, stored, online: true })).toEqual({ kind: 'session', session: live });
  });

  it('no connection + a stored session: opens signed in (offline) instead of locking the person out', () => {
    expect(resolveInitialSession({ session: null, error: null, stored, online: false })).toEqual({ kind: 'offline', user: offlineUser });
  });

  it('online but the server is unreachable (the refresh failed with a network error): same', () => {
    const error = new AuthRetryableFetchError('Failed to fetch', 0);
    expect(resolveInitialSession({ session: null, error, stored, online: true })).toEqual({ kind: 'offline', user: offlineUser });
  });

  it('the first check hanging past the timeout: same', () => {
    expect(resolveInitialSession({ session: null, error: null, stored, online: true, timedOut: true })).toEqual({ kind: 'offline', user: offlineUser });
  });

  it('a session the server REJECTED (revoked / invalid) is a real sign-out', () => {
    const error = new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found');
    expect(resolveInitialSession({ session: null, error, stored, online: true })).toEqual({ kind: 'guest' });
  });

  it('nothing stored, or nothing that could ever refresh, is a guest — even offline', () => {
    expect(resolveInitialSession({ session: null, error: null, stored: null, online: false })).toEqual({ kind: 'guest' });
    expect(resolveInitialSession({ session: null, error: null, stored: { ...stored, hasRefreshToken: false }, online: false })).toEqual({ kind: 'guest' });
  });
});
