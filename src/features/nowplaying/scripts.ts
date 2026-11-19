/**
 * Registers the music-tab content script when — and only when — the person turned the feature on AND the browser granted the
 * optional host permissions for the players. Turning it off (or the browser revoking the permission) removes it again.
 *
 *   Chromium (MV3)  chrome.scripting.registerContentScripts — persistent across restarts; re-checked every time the worker starts.
 *   Firefox (MV2)   browser.contentScripts.register — lives only until the browser closes, so the (persistent) background page
 *                   registers it again on every start.
 *
 * Tabs that were already open when the feature was turned on get the script injected right away, so nobody has to reload their
 * Spotify tab to see it work. (The content script guards against running twice in one page.)
 */
import { browser } from 'wxt/browser';
import { SCRIPT_FILE, SCRIPT_ID } from './protocol.ts';
import { MUSIC_MATCH_PATTERNS } from './sources.ts';

const patterns = [...MUSIC_MATCH_PATTERNS];

export type ScriptRegistrar = {
  /** Does this browser profile currently allow the extension on all the player pages? */
  hasAccess(): Promise<boolean>;
  /** Make sure the content script is registered (idempotent). Injects into open player tabs only when it was newly registered. */
  register(): Promise<void>;
  unregister(): Promise<void>;
};

async function hasAccess(): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: patterns });
  } catch {
    return false;
  }
}

type FirefoxContentScripts = {
  register(options: { matches: string[]; js: Array<{ file: string }>; runAt: string; allFrames: boolean }): Promise<{ unregister(): Promise<void> }>;
};

function chromiumRegistrar(): ScriptRegistrar {
  const scripting = browser.scripting;
  return {
    hasAccess,
    async register() {
      const existing = await scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }).catch(() => []);
      const current = existing[0];
      if (current && JSON.stringify([...(current.matches ?? [])].sort()) === JSON.stringify([...patterns].sort())) return;
      if (current) await scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => {});
      await scripting.registerContentScripts([
        { id: SCRIPT_ID, matches: patterns, js: [SCRIPT_FILE], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true },
      ]);
      const open = await browser.tabs.query({ url: patterns }).catch(() => []);
      for (const tab of open) {
        if (tab.id !== undefined) void scripting.executeScript({ target: { tabId: tab.id }, files: [SCRIPT_FILE as never] }).catch(() => {});
      }
    },
    async unregister() {
      await scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => {});
    },
  };
}

function firefoxRegistrar(): ScriptRegistrar {
  const contentScripts = (browser as unknown as { contentScripts?: FirefoxContentScripts }).contentScripts;
  let handle: { unregister(): Promise<void> } | null = null;
  return {
    hasAccess,
    async register() {
      if (handle || !contentScripts) return;
      handle = await contentScripts.register({ matches: patterns, js: [{ file: SCRIPT_FILE }], runAt: 'document_idle', allFrames: false });
      const tabs = (
        browser as unknown as { tabs: { query(q: object): Promise<Array<{ id?: number }>>; executeScript(id: number, d: object): Promise<unknown> } }
      ).tabs;
      for (const tab of await tabs.query({ url: patterns }).catch(() => [])) {
        if (tab.id !== undefined) void tabs.executeScript(tab.id, { file: SCRIPT_FILE }).catch(() => {});
      }
    },
    async unregister() {
      await handle?.unregister().catch(() => {});
      handle = null;
    },
  };
}

/** Decided at build time (like the VibeParty bridge): Firefox is MV2. */
export const createScriptRegistrar = (): ScriptRegistrar => (import.meta.env.MANIFEST_VERSION === 2 ? firefoxRegistrar() : chromiumRegistrar());
