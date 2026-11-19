/**
 * An unread count in the tab title — `(3) Chat · pact` — that coexists with whoever else writes `document.title`.
 *
 * The title has other owners: AppShell sets it per section, and TimerEngine rewrites it every second while a focus timer
 * runs. So nothing here ever *sets the base title*; we only decorate whatever the others last wrote. A MutationObserver on
 * the document head notices every external write and puts our prefix back on, and strips it again when it no longer
 * applies. The prefix is always stripped before comparing, so the two can never ping-pong.
 */
import { useEffect, useRef } from 'react';

const BADGE = /^\((?:\d{1,3}\+?)\) /;

export const stripBadge = (title: string): string => title.replace(BADGE, '');

/** `(3) Chat · pact`; no prefix for 0; capped at 99+. */
export const withBadge = (title: string, count: number): string => {
  const base = stripBadge(title);
  return count > 0 ? `(${count > 99 ? '99+' : Math.floor(count)}) ${base}` : base;
};

export type TitleBadge = {
  /** `show`: whether the prefix should be visible right now (tab hidden, or the person is on another section). */
  set(count: number, show: boolean): void;
  stop(): void;
};

export function createTitleBadge(doc: Document = document, ObserverCtor: typeof MutationObserver | undefined = globalThis.MutationObserver): TitleBadge {
  let count = 0;
  let show = false;
  const apply = () => {
    const want = withBadge(doc.title, show ? count : 0);
    if (doc.title !== want) doc.title = want;
  };
  const observer = ObserverCtor ? new ObserverCtor(apply) : null;
  observer?.observe(doc.head ?? doc.documentElement, { childList: true, characterData: true, subtree: true });
  return {
    set(c, s) {
      count = Math.max(0, c);
      show = s;
      apply();
    },
    stop() {
      observer?.disconnect();
      count = 0;
      show = false;
      apply();
    },
  };
}

/**
 * Prefix the tab title with `count` while the tab is hidden or `onOtherSection` is true. Mount once (AppShell).
 */
export function useTitleBadge(count: number, onOtherSection: boolean): void {
  const badge = useRef<TitleBadge | null>(null);
  const latest = useRef({ count, onOtherSection });
  latest.current = { count, onOtherSection };

  const refresh = () => badge.current?.set(latest.current.count, latest.current.onOtherSection || document.visibilityState === 'hidden');

  // biome-ignore lint/correctness/useExhaustiveDependencies: created once; `refresh` only reads refs
  useEffect(() => {
    badge.current = createTitleBadge();
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      badge.current?.stop();
      badge.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `refresh` only reads refs; these are the triggers
  useEffect(refresh, [count, onOtherSection]);
}
