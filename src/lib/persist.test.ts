import { beforeEach, describe, expect, it } from 'vitest';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { freezePersistence, persistenceFrozen, resetPersistenceForTests, syncAcrossTabs } from '@/lib/persist';

const make = (name: string) => {
  const useStore = create<{ n: number; set: (n: number) => void }>()(persist((set) => ({ n: 0, set: (n) => set({ n }) }), { name, version: 1 }));
  syncAcrossTabs(name, useStore);
  return useStore;
};

describe('freezePersistence', () => {
  beforeEach(() => resetPersistenceForTests());

  it('stops every registered store from writing, so stale in-memory data can’t be written back before a reload', () => {
    const a = make('t-a');
    const b = make('t-b');
    a.getState().set(1);
    b.getState().set(1);
    expect(JSON.parse(localStorage.getItem('t-a') as string).state.n).toBe(1);

    freezePersistence();
    expect(persistenceFrozen()).toBe(true);
    // something else (a restore, an account switch) rewrites the data…
    localStorage.setItem('t-a', JSON.stringify({ state: { n: 99 }, version: 1 }));
    // …and the old in-memory store changing must not clobber it
    a.getState().set(2);
    b.getState().set(2);
    expect(JSON.parse(localStorage.getItem('t-a') as string).state.n).toBe(99);
    expect(JSON.parse(localStorage.getItem('t-b') as string).state.n).toBe(1);
    expect(a.getState().n).toBe(2); // memory still works — only the writes are cut
  });

  it('stops following other tabs’ writes while frozen', () => {
    const a = make('t-c');
    freezePersistence();
    localStorage.setItem('t-c', JSON.stringify({ state: { n: 5 }, version: 1 }));
    window.dispatchEvent(new StorageEvent('storage', { key: 't-c', storageArea: window.localStorage }));
    expect(a.getState().n).toBe(0);
  });
});
