import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { needsAccount } from '@/app/routes';
import { persistenceFrozen, resetPersistenceForTests } from '@/lib/persist';
import { AUTH_STORAGE_KEY } from './client';
import { accountGuard, bindTab, claimLocalData, isAccountCurrent, localOwner, OWNER_KEY, resetTabBinding, startAccountWatch, tabOwner } from './owner';

describe('claimLocalData', () => {
  beforeEach(() => {
    localStorage.clear();
    resetTabBinding();
    resetPersistenceForTests();
  });

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

import { isCode, isEmail, normalizeCode, normalizeEmail } from './auth';

describe('email sign-in input checks', () => {
  it('accepts normal emails and normalises case and spaces', () => {
    expect(isEmail('  Dev@Example.com ')).toBe(true);
    expect(normalizeEmail('  Dev@Example.com ')).toBe('dev@example.com');
  });
  it('rejects things that are not emails', () => {
    for (const bad of ['', 'plain', 'a@b', 'a b@c.com', '@c.com', 'a@@c.com', `${'x'.repeat(250)}@c.com`]) expect(isEmail(bad)).toBe(false);
  });
  it('accepts 6–10 digit codes, tolerating pasted spaces', () => {
    expect(isCode('123456')).toBe(true);
    expect(isCode('123 456')).toBe(true);
    expect(normalizeCode(' 123 456 ')).toBe('123456');
    for (const bad of ['', '12345', '12345a', '12345678901', 'abcdef']) expect(isCode(bad)).toBe(false);
  });
});

const sessionOf = (id: string) => JSON.stringify({ access_token: 'a', refresh_token: 'r', user: { id } });

describe('a second tab cannot slip another account past the guard', () => {
  beforeEach(() => {
    localStorage.clear();
    resetTabBinding();
    resetPersistenceForTests();
  });

  it('tab A holds account A’s data in memory; tab B already switched the device to account B → A must reload, not adopt B', async () => {
    localStorage.setItem(OWNER_KEY, 'user-a');
    bindTab(); // this tab started with A's data
    // tab B (another page) signs in as B: it wipes A's data and claims the device
    localStorage.removeItem('pact-notes');
    localStorage.setItem(OWNER_KEY, 'user-b');
    localStorage.setItem('pact-notes', 'B-new-data');
    // …now the sign-in event reaches tab A. The disk says "owner = B", which used to look fine.
    expect(await claimLocalData('user-b')).toBe(false);
    expect(persistenceFrozen()).toBe(true); // A's stale memory must never be written back
    expect(localStorage.getItem('pact-notes')).toBe('B-new-data'); // and B's fresh data is not wiped by the late tab
    expect(localOwner()).toBe('user-b');
  });

  it('the first tab to notice a change of account wipes the old data and claims the device', async () => {
    localStorage.setItem(OWNER_KEY, 'user-a');
    localStorage.setItem('pact-notes', 'A-data');
    bindTab();
    expect(await claimLocalData('user-b')).toBe(false);
    expect(localStorage.getItem('pact-notes')).toBeNull();
    expect(localOwner()).toBe('user-b');
  });

  it('a tab that started as a guest simply joins the account that claimed the device', async () => {
    bindTab(); // nobody had claimed anything
    localStorage.setItem(OWNER_KEY, 'user-a'); // another tab claimed it
    expect(await claimLocalData('user-a')).toBe(true);
    expect(tabOwner()).toBe('user-a');
  });

  it('the tab’s own account signing in again is fine', async () => {
    localStorage.setItem(OWNER_KEY, 'user-a');
    bindTab();
    expect(await claimLocalData('user-a')).toBe(true);
    expect(persistenceFrozen()).toBe(false);
  });
});

describe('isAccountCurrent — the check made right before every upload and merge', () => {
  beforeEach(() => localStorage.clear());

  it('needs the device owner AND the stored session to be the same account', () => {
    expect(isAccountCurrent('user-a')).toBe(false);
    localStorage.setItem(OWNER_KEY, 'user-a');
    expect(isAccountCurrent('user-a')).toBe(false); // no session at all (signed out in another tab)
    localStorage.setItem(AUTH_STORAGE_KEY, sessionOf('user-a'));
    expect(isAccountCurrent('user-a')).toBe(true);
    localStorage.setItem(AUTH_STORAGE_KEY, sessionOf('user-b')); // another tab signed in as someone else
    expect(isAccountCurrent('user-a')).toBe(false);
    expect(isAccountCurrent('user-b')).toBe(false); // …and the device still belongs to A
    localStorage.setItem(OWNER_KEY, 'user-b');
    expect(isAccountCurrent('user-b')).toBe(true);
  });
});

describe('following other tabs (the storage event)', () => {
  const onSessionRemoved = vi.fn();
  beforeAll(() => startAccountWatch({ onSessionRemoved }));
  beforeEach(() => {
    localStorage.clear();
    resetTabBinding();
    resetPersistenceForTests();
    accountGuard.reload = vi.fn();
  });

  const fire = (key: string, newValue: string | null) => window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: window.localStorage }));

  it('another tab claiming the device for a different account freezes this tab and reloads it', () => {
    localStorage.setItem(OWNER_KEY, 'user-a');
    bindTab();
    fire(OWNER_KEY, 'user-b');
    expect(persistenceFrozen()).toBe(true);
    expect(accountGuard.reload).toHaveBeenCalledOnce();
  });

  it('a different account’s session appearing in storage does the same, even before the owner changes', () => {
    localStorage.setItem(OWNER_KEY, 'user-a');
    bindTab();
    fire(AUTH_STORAGE_KEY, sessionOf('user-b'));
    expect(accountGuard.reload).toHaveBeenCalledOnce();
  });

  it('the same account refreshing its token, or claiming the device again, changes nothing', () => {
    localStorage.setItem(OWNER_KEY, 'user-a');
    bindTab();
    fire(AUTH_STORAGE_KEY, sessionOf('user-a'));
    fire(OWNER_KEY, 'user-a');
    expect(accountGuard.reload).not.toHaveBeenCalled();
    expect(persistenceFrozen()).toBe(false);
  });

  it('an unclaimed tab adopts the new owner instead of reloading', () => {
    bindTab();
    fire(OWNER_KEY, 'user-a');
    expect(tabOwner()).toBe('user-a');
    expect(accountGuard.reload).not.toHaveBeenCalled();
  });

  it('the session disappearing (signed out in another tab — even by hand, with no broadcast) is reported', () => {
    fire(AUTH_STORAGE_KEY, null);
    expect(onSessionRemoved).toHaveBeenCalledOnce();
  });
});
