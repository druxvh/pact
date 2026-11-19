/**
 * The new-tab page's side of the browser APIs "Now playing" needs. Everything degrades to "not available" outside the extension
 * (the dev server, the harness pages), where there are no extension permissions or storage areas.
 */
import { browser } from 'wxt/browser';
import { isExtension } from '@/lib/ext';
import { CONFIG_KEY, CURRENT_KEY, type LocalNow, type NowPlayingConfig, parseConfig, parseCurrent } from './protocol';
import { MUSIC_MATCH_PATTERNS } from './sources';

/** Can this page read music tabs at all (an installed extension with the permissions API)? */
export const canDetect: boolean = isExtension && typeof browser?.permissions?.request === 'function';

const patterns = [...MUSIC_MATCH_PATTERNS];
const sessionArea = () => (browser.storage as { session?: typeof browser.storage.local }).session ?? browser.storage.local;

/** Has the browser granted the player pages right now? */
export async function hasMusicAccess(): Promise<boolean> {
  if (!canDetect) return false;
  try {
    return await browser.permissions.contains({ origins: patterns });
  } catch {
    return false;
  }
}

/**
 * Ask the browser for the player pages. Must be called straight from a click: browsers only show the prompt (and only allow
 * the call) while a user gesture is active, so nothing is awaited before it.
 */
export function requestMusicAccess(): Promise<boolean> {
  if (!canDetect) return Promise.resolve(false);
  return browser.permissions.request({ origins: patterns }).catch(() => false);
}

/** Give the permission back (turning the feature off). */
export async function dropMusicAccess(): Promise<void> {
  if (!canDetect) return;
  try {
    await browser.permissions.remove({ origins: patterns });
  } catch {
    /* already gone */
  }
}

/** Tell the service worker what the person asked for. */
export async function writeConfig(config: NowPlayingConfig): Promise<void> {
  if (!isExtension) return;
  try {
    await browser.storage.local.set({ [CONFIG_KEY]: config });
  } catch {
    /* storage unavailable */
  }
}

/** The service worker rewrote the preference (it found out the account isn't sharing): follow it. */
export function onConfigChanged(cb: (config: NowPlayingConfig) => void): () => void {
  if (!isExtension) return () => {};
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes[CONFIG_KEY]) cb(parseConfig(changes[CONFIG_KEY].newValue));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** The browser's permission set changed (the person revoked it at chrome://extensions, or granted it). */
export function onPermissionsChanged(cb: () => void): () => void {
  if (!canDetect) return () => {};
  browser.permissions.onRemoved?.addListener(cb);
  browser.permissions.onAdded?.addListener(cb);
  return () => {
    browser.permissions.onRemoved?.removeListener(cb);
    browser.permissions.onAdded?.removeListener(cb);
  };
}

/** What is playing in this browser right now (the service worker keeps it in session storage). */
export async function readCurrent(): Promise<{ now: LocalNow | null; at: number } | null> {
  if (!isExtension) return null;
  try {
    const raw = (await sessionArea().get(CURRENT_KEY))[CURRENT_KEY] as { at?: unknown } | undefined;
    return raw && typeof raw.at === 'number' ? { now: parseCurrent(raw, raw.at), at: raw.at } : null;
  } catch {
    return null;
  }
}

export function onCurrentChanged(cb: (value: { now: LocalNow | null; at: number }) => void): () => void {
  if (!isExtension) return () => {};
  const listener = (changes: Record<string, { newValue?: unknown }>) => {
    const raw = changes[CURRENT_KEY]?.newValue as { at?: unknown } | undefined;
    if (raw && typeof raw.at === 'number') cb({ now: parseCurrent(raw, raw.at), at: raw.at });
    else if (CURRENT_KEY in changes) cb({ now: null, at: Date.now() });
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
