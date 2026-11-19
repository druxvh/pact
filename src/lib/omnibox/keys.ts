/** Key combos for omnibox actions, in the same notation as `useHotkeys`: `mod+enter`, `mod+c`, `mod+shift+backspace`. */
export type KeyLike = { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };

const KEY_ALIASES: Record<string, string> = { enter: 'enter', return: 'enter', backspace: 'backspace', delete: 'delete', escape: 'escape', esc: 'escape' };

const normKey = (key: string) => {
  const k = key.toLowerCase();
  return KEY_ALIASES[k] ?? k;
};

export function matchesHotkey(spec: string, e: KeyLike, isMac: boolean): boolean {
  const parts = spec.toLowerCase().split('+');
  const key = normKey(parts[parts.length - 1] ?? '');
  const wantMod = parts.includes('mod');
  const hasMod = isMac ? e.metaKey : e.ctrlKey;
  // on a Mac a stray Ctrl, elsewhere a stray Meta, means a different shortcut
  const strayMod = isMac ? e.ctrlKey : e.metaKey;
  return wantMod === hasMod && !strayMod && parts.includes('shift') === e.shiftKey && parts.includes('alt') === e.altKey && normKey(e.key) === key;
}

const GLYPH: Record<string, string> = {
  enter: '↵',
  backspace: '⌫',
  delete: '⌦',
  escape: 'esc',
  tab: '⇥',
  arrowright: '→',
  arrowleft: '←',
  arrowup: '↑',
  arrowdown: '↓',
};

/** `mod+enter` → ['⌘', '↵'] (or ['Ctrl', '↵']), ready to render as key caps. */
export function hotkeyCaps(spec: string, modLabel: string): string[] {
  return spec
    .toLowerCase()
    .split('+')
    .map((p) => (p === 'mod' ? modLabel : p === 'shift' ? '⇧' : p === 'alt' ? (modLabel === '⌘' ? '⌥' : 'Alt') : (GLYPH[p] ?? p.toUpperCase())));
}
