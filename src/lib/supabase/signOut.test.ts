import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({
  AUTH_STORAGE_KEY: 'pact-auth',
  SUPABASE_URL: 'https://x.supabase.co',
  isBackendConfigured: true,
  hasStoredSession: () => false,
  supabase: { auth: { signOut: mocks.signOut } },
}));

import { signOut } from '@/lib/supabase/auth';
import * as stored from '@/lib/supabase/stored';
import { useAuthStore } from '@/store/useAuthStore';

const KEY = 'pact-auth';
const seed = () => localStorage.setItem(KEY, JSON.stringify({ access_token: 'a', refresh_token: 'r', user: { id: 'u1' } }));
const setOnline = (online: boolean) => Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });

describe('signOut', () => {
  beforeEach(() => {
    localStorage.clear();
    seed();
    setOnline(true);
    useAuthStore.setState({ status: 'signedIn', user: { id: 'u1', email: null, provider: null, name: null }, offline: false });
    mocks.signOut.mockReset();
  });

  it('online: ends the account’s sessions everywhere (global scope), not just this device', async () => {
    mocks.signOut.mockImplementation(async () => {
      localStorage.removeItem(KEY); // what supabase-js does on success
      return { error: null };
    });
    const out = await signOut();
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(out).toEqual({ signedOutHere: true, revokedEverywhere: true });
    expect(useAuthStore.getState().status).toBe('guest');
  });

  it('a failure is no longer swallowed: the server refused → still signed out here, and it says the rest did not happen', async () => {
    // supabase-js RETURNS this error and — for the global scope — leaves the session in storage
    mocks.signOut.mockResolvedValue({ error: new Error('Failed to fetch') });
    const out = await signOut();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' }); // the fallback that never depends on the network
    expect(out.signedOutHere).toBe(true);
    expect(out.revokedEverywhere).toBe(false);
    expect(out.message).toMatch(/fetch/i);
    expect(stored.storedSession()).toBeNull(); // removed by hand when supabase-js didn't
    expect(useAuthStore.getState()).toMatchObject({ status: 'guest', user: null });
  });

  it('offline: does not even try the network call, just ends the session on this device', async () => {
    setOnline(false);
    mocks.signOut.mockResolvedValue({ error: null });
    const out = await signOut();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(out).toMatchObject({ signedOutHere: true, revokedEverywhere: false });
    expect(stored.storedSession()).toBeNull();
    expect(useAuthStore.getState().status).toBe('guest');
  });

  it('an exception from the client is handled the same way', async () => {
    mocks.signOut.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ error: null });
    const out = await signOut();
    expect(out).toMatchObject({ signedOutHere: true, revokedEverywhere: false, message: 'boom' });
  });

  it('never leaves the app half signed-in: if the session cannot be removed, it says so and keeps the signed-in state', async () => {
    mocks.signOut.mockResolvedValue({ error: new Error('offline') });
    const remove = vi.spyOn(stored, 'removeStoredSession').mockImplementation(() => {}); // storage refuses the removal
    const out = await signOut();
    remove.mockRestore();
    expect(out.signedOutHere).toBe(false);
    expect(useAuthStore.getState().status).toBe('signedIn'); // consistent with the session that is really still there
  });
});
