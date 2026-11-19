import { beforeEach, describe, expect, it } from 'vitest';
import { AUTH_STORAGE_KEY } from '@/lib/supabase/client';
import { parseStoredSession, removeStoredSession, storedSession, storedSessionUserId } from '@/lib/supabase/stored';

const session = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    access_token: 'a',
    refresh_token: 'r',
    expires_at: 1_800_000_000,
    user: { id: 'user-1', email: 'a@b.co', app_metadata: { provider: 'github' }, user_metadata: { full_name: 'Ada' } },
    ...over,
  });

describe('parseStoredSession', () => {
  it('reads the user and whether a refresh token is there (the access token expiring says nothing)', () => {
    expect(parseStoredSession(session())).toEqual({
      userId: 'user-1',
      email: 'a@b.co',
      provider: 'github',
      name: 'Ada',
      hasRefreshToken: true,
      expiresAt: 1_800_000_000,
    });
    expect(parseStoredSession(session({ expires_at: 1 }))?.hasRefreshToken).toBe(true);
    expect(parseStoredSession(session({ refresh_token: '' }))?.hasRefreshToken).toBe(false);
  });

  it('never trusts what is in storage', () => {
    for (const bad of [null, '', 'nope', '[]', '{"user":null}', '{"user":{"id":5}}', '{"user":{"id":"  "}}', 'x'.repeat(300_000)])
      expect(parseStoredSession(bad)).toBeNull();
    expect(parseStoredSession(session({ user: { id: 'u', email: 5, app_metadata: 'x', user_metadata: [] } }))).toMatchObject({
      userId: 'u',
      email: null,
      provider: null,
      name: null,
    });
  });
});

describe('the stored session in localStorage', () => {
  beforeEach(() => localStorage.clear());

  it('tells which account is signed in (in any tab)', () => {
    expect(storedSessionUserId()).toBeNull();
    localStorage.setItem(AUTH_STORAGE_KEY, session());
    expect(storedSession()?.userId).toBe('user-1');
    expect(storedSessionUserId()).toBe('user-1');
  });

  it('can be removed by hand, with its PKCE verifier', () => {
    localStorage.setItem(AUTH_STORAGE_KEY, session());
    localStorage.setItem(`${AUTH_STORAGE_KEY}-code-verifier`, 'v');
    removeStoredSession();
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(`${AUTH_STORAGE_KEY}-code-verifier`)).toBeNull();
  });
});
