import { useEffect, useRef } from 'react';

/**
 * Tiny global hotkey engine. Supports:
 *   - single keys:           '?', '/', 'n'
 *   - modifier combos:       'mod+k'  (mod = ⌘ on macOS, Ctrl elsewhere)
 *   - Gmail-style sequences: 'g n'    (press g, then n within 1s)
 *   - the Space key:         'space'
 * Bindings are ignored while typing in inputs unless `allowInInput` is set
 * (so `n` doesn't hijack a text field, but `mod+k` still works everywhere).
 */
export type Binding = {
  keys: string;
  handler: (e: KeyboardEvent) => void;
  allowInInput?: boolean;
  /** Skip the binding (e.g. when a dialog is open). */
  enabled?: boolean;
  /** Don't fire while a button/link/tab/etc. has focus (so Space doesn't double-activate it). */
  ignoreInteractive?: boolean;
};

const SEQUENCE_TIMEOUT_MS = 1000;
const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

/** Label for the platform's primary modifier key. */
export const MOD_KEY = isMac ? '⌘' : 'Ctrl';
export const IS_MAC = isMac;

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el?.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

function isInteractiveTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return Boolean(el?.closest?.('button, a[href], summary, [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="switch"]'));
}

function matchesCombo(combo: string, e: KeyboardEvent): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts[parts.length - 1] ?? '';
  const wantMod = parts.includes('mod');
  const wantShift = parts.includes('shift');
  const wantAlt = parts.includes('alt');
  const hasMod = isMac ? e.metaKey : e.ctrlKey;
  if (wantMod !== hasMod) return false;
  if (!wantMod && (e.metaKey || e.ctrlKey)) return false;
  if (wantAlt !== e.altKey) return false;
  // Shift is implicit for characters like '?' — only enforce when explicitly requested.
  if (wantShift && !e.shiftKey) return false;
  // 'space' is the token for the literal Space key (a real space in `keys` means a sequence like 'g n')
  return e.key.toLowerCase() === (key === 'space' ? ' ' : key);
}

export function useHotkeys(bindings: Binding[]): void {
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    let pending: string | null = null;
    let timer: number | undefined;

    const clearPending = () => {
      pending = null;
      window.clearTimeout(timer);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat) return;
      const typing = isTypingTarget(e.target);
      const interactive = isInteractiveTarget(e.target);
      const active = ref.current.filter((b) => b.enabled !== false && (!typing || b.allowInInput) && !(interactive && b.ignoreInteractive));

      // 1) finish a pending sequence ("g" then "n")
      if (pending) {
        const seq = `${pending} ${e.key.toLowerCase()}`;
        const hit = active.find((b) => b.keys.toLowerCase() === seq);
        clearPending();
        if (hit) {
          e.preventDefault();
          hit.handler(e);
          return;
        }
      }

      // 2) direct combos / single keys
      for (const b of active) {
        if (b.keys.includes(' ')) continue; // sequences handled below
        if (matchesCombo(b.keys, e)) {
          e.preventDefault();
          b.handler(e);
          return;
        }
      }

      // 3) start a sequence if any binding begins with this key
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (active.some((b) => b.keys.toLowerCase().startsWith(`${k} `))) {
          pending = k;
          timer = window.setTimeout(clearPending, SEQUENCE_TIMEOUT_MS);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(timer);
    };
  }, []);
}
