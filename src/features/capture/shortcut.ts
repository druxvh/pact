import { browser } from 'wxt/browser';
import { CAPTURE_COMMAND_KEYS, SHORTCUT_SETTINGS_URL } from '@/features/capture/defaults';
import { isExtension, openUrl } from '@/lib/ext';
import { MOD_KEY } from '@/lib/hotkeys';

const isMac = MOD_KEY === '⌘';

const MAC_GLYPH: Record<string, string> = { command: '⌘', cmd: '⌘', macctrl: '⌃', ctrl: '⌃', control: '⌃', alt: '⌥', option: '⌥', shift: '⇧' };

/**
 * A shortcut as one label per key. Chrome reports `Alt+Shift+N` on Windows/Linux but glyphs (`⇧⌘Y`) on macOS, and the manifest
 * spells it `Command+Shift+Y` — all three become separate key labels.
 */
export function shortcutKeys(shortcut: string): string[] {
  const raw = shortcut.includes('+') ? shortcut.split('+') : Array.from(shortcut);
  return raw
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => (isMac ? (MAC_GLYPH[k.toLowerCase()] ?? k) : k));
}

/** What the manifest suggests on this platform — the fallback label when the real binding can't be read. */
export const defaultCaptureKeys = (): string[] => shortcutKeys(isMac ? CAPTURE_COMMAND_KEYS.mac : CAPTURE_COMMAND_KEYS.default);

/**
 * The key combination currently bound to "open quick capture" — which people may have changed.
 * `[]` means it is bound to nothing (another extension already owned the suggestion, or it was cleared); `null` means this
 * page can't tell (a plain web page during development, or a browser without the commands API).
 */
export async function readCaptureShortcut(): Promise<string[] | null> {
  if (!isExtension) return null;
  try {
    const commands = await browser.commands?.getAll?.();
    if (!commands) return null;
    const command = commands.find((c) => c.name === '_execute_action' || c.name === '_execute_browser_action');
    if (!command) return null;
    return command.shortcut ? shortcutKeys(command.shortcut) : [];
  } catch {
    return null;
  }
}

/** Chromium keeps every extension's shortcuts on one settings page; there's no API to bind a key from inside the extension. */
export function openShortcutSettings(): void {
  openUrl(SHORTCUT_SETTINGS_URL, { newTab: true });
}
