/**
 * "Your" track on the new-tab page: what the service worker says is playing in this browser. A zustand store so every widget
 * shares one value (and so a dev page or a test can set it directly). A value the worker hasn't confirmed for a while counts as
 * "nothing" — if the worker lost track of a closed tab, the page doesn't go on claiming music.
 */
import { useEffect, useReducer } from 'react';
import { create } from 'zustand';
import { onCurrentChanged, readCurrent } from './extension';
import { CURRENT_STALE_MS, type LocalNow } from './protocol';

type LocalNowState = { now: LocalNow | null; at: number };

export const useLocalNowStore = create<LocalNowState>(() => ({ now: null, at: 0 }));

/** Follow the service worker. Returns the stop function. Safe outside the extension (it just never changes). */
export function startLocalNowSync(): () => void {
  let live = true;
  void readCurrent().then((v) => {
    if (live && v) useLocalNowStore.setState(v);
  });
  const off = onCurrentChanged((v) => useLocalNowStore.setState(v));
  return () => {
    live = false;
    off();
  };
}

/** The current track in this browser, or null. `at: Date.now()` marks a value as just confirmed (dev pages and tests). */
export function useLocalNow(): LocalNow | null {
  const value = useLocalNowStore((s) => s.now);
  const at = useLocalNowStore((s) => s.at);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  // Re-check the age now and then; nothing else changes while the worker is silent.
  useEffect(() => {
    if (!value) return;
    const id = window.setInterval(tick, 20_000);
    return () => window.clearInterval(id);
  }, [value]);
  return value && Date.now() - at <= CURRENT_STALE_MS ? value : null;
}
