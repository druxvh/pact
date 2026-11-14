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
type Persistable = { persist: { rehydrate: () => Promise<void> | void } };

export function syncAcrossTabs(storageKey: string, store: Persistable): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('storage', (e) => {
    if (e.storageArea !== window.localStorage) return;
    // key === null means localStorage.clear() — let the stores fall back to defaults on next load.
    if (e.key === storageKey) void store.persist.rehydrate();
  });
}
