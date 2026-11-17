/**
 * Cross-tab sync for zustand `persist` stores.
 *
 * A new-tab extension routinely has several pact tabs open at once. Without this,
 * each tab keeps its own in-memory copy and the *last tab to write wins* — silently
 * erasing notes/tasks created in another tab. The `storage` event fires in every
 * *other* same-origin document whenever localStorage changes, so we simply rehydrate.
 * (Rehydrating writes identical JSON back, which does not re-fire the event, so
 * there is no ping-pong between tabs.)
 */
import { createJSONStorage } from 'zustand/middleware';

type Persistable = {
  persist: {
    rehydrate: () => Promise<void> | void;
    /** Present on every zustand persist store; used by `freezePersistence`. */
    setOptions: (options: never) => void;
  };
};

const registry = new Map<string, Persistable>();
let frozen = false;

export function syncAcrossTabs(storageKey: string, store: Persistable): void {
  if (typeof window === 'undefined') return;
  registry.set(storageKey, store);
  window.addEventListener('storage', (e) => {
    if (frozen) return; // this tab is about to reload — don't rehydrate from storage that is being rewritten
    if (e.storageArea !== window.localStorage) return;
    // key === null means localStorage.clear() — let the stores fall back to defaults on next load.
    if (e.key === storageKey) void store.persist.rehydrate();
  });
}

const NOOP_STORAGE = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

/**
 * Stop every registered store from writing to localStorage (and from rehydrating) for the rest of this page's life.
 *
 * Used right before the page rewrites persisted data and reloads — restoring a backup, switching accounts, signing
 * out — so a store that still holds the *old* in-memory data can't write it back over (or into) the new data in the
 * few milliseconds before the reload. Reads still work; there is no way to un-freeze other than reloading.
 */
export function freezePersistence(): void {
  if (frozen) return;
  frozen = true;
  for (const store of registry.values()) {
    try {
      store.persist.setOptions({ storage: createJSONStorage(() => NOOP_STORAGE) } as never);
    } catch {
      /* a store without the persist API (persistence disabled) has nothing to freeze */
    }
  }
}

export const persistenceFrozen = (): boolean => frozen;

/** Test helper: forget frozen state and registered stores. */
export function resetPersistenceForTests(): void {
  frozen = false;
  registry.clear();
}
