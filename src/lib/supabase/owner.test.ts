import { beforeEach, describe, expect, it } from 'vitest';
import { needsAccount } from '@/app/routes';
import { claimLocalData, localOwner } from './owner';

describe('claimLocalData', () => {
  beforeEach(() => localStorage.clear());

  it('the first account to sign in claims what is already on the device and keeps it', async () => {
    localStorage.setItem('pact-notes', '{"state":{"notes":[1]}}');
    expect(await claimLocalData('user-a')).toBe(true);
    expect(localOwner()).toBe('user-a');
    expect(localStorage.getItem('pact-notes')).not.toBeNull();
  });

  it('the same account signing in again changes nothing', async () => {
    await claimLocalData('user-a');
    localStorage.setItem('pact-kanban', 'x');
    expect(await claimLocalData('user-a')).toBe(true);
    expect(localStorage.getItem('pact-kanban')).toBe('x');
  });

  it('a different account never inherits the previous account’s data', async () => {
    await claimLocalData('user-a');
    for (const k of ['pact-user', 'pact-notes', 'pact-kanban', 'pact-timer', 'pact-chat', 'pact-home-layout', 'pact-sync-notes'])
      localStorage.setItem(k, 'private');
    localStorage.setItem('pact-theme', 'keep'); // browser preferences aren't personal data
    localStorage.setItem('pact-home', 'keep'); // shortcuts are guest features
    expect(await claimLocalData('user-b')).toBe(false); // caller must reload
    for (const k of ['pact-user', 'pact-notes', 'pact-kanban', 'pact-timer', 'pact-chat', 'pact-home-layout', 'pact-sync-notes'])
      expect(localStorage.getItem(k)).toBeNull();
    expect(localStorage.getItem('pact-theme')).toBe('keep');
    expect(localStorage.getItem('pact-home')).toBe('keep');
    expect(localOwner()).toBe('user-b');
  });
});

describe('what guests can use', () => {
  it('only Home is open without an account', () => {
    expect(needsAccount('home')).toBe(false);
    for (const s of ['notes', 'kanban', 'timer', 'tools', 'chat', 'party', 'settings'] as const) expect(needsAccount(s)).toBe(true);
  });
});
