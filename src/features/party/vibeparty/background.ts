/**
 * Wires the pure `PartyController` to the browser: extension messaging, tabs, the optional relay WebSocket,
 * and persistence so a party survives Chrome tearing down the MV3 service worker.
 */
import { browser } from 'wxt/browser';
import { PartyController } from './controller.ts';
import type { BackgroundToContent, OpenResult } from './protocol.ts';
import { RelayClient } from './relay-client.ts';
import { cleanName, cleanRoom, parseAppMessage, parseRelayUrl } from './sanitize.ts';

const SESSION_KEY = 'vibeparty:controller';
const PRUNE_EVERY_MS = 30_000;
const PERSIST_DEBOUNCE_MS = 250;

/**
 * Reuse an open YouTube tab if there is one (preferring a watch page), otherwise open a new one.
 * Either way the tab is joined to the room — no hand-off through storage, no race between two tabs.
 */
async function openParty(controller: PartyController, rawRoom: string, rawName: string): Promise<OpenResult> {
  const room = cleanRoom(rawRoom);
  if (!room) return { ok: false, error: 'That room code isn’t valid.' };
  const name = cleanName(rawName);

  const open = await browser.tabs.query({ url: 'https://www.youtube.com/*' }).catch(() => []);
  const target = open.find((t) => t.url?.includes('/watch')) ?? open[0];

  if (target?.id !== undefined) {
    const id = target.id;
    await browser.tabs.update(id, { active: true }).catch(() => {});
    if (target.windowId !== undefined) await browser.windows.update(target.windowId, { focused: true }).catch(() => {});
    const alive = await browser.tabs.sendMessage(id, { type: 'vibeparty:probe' } satisfies BackgroundToContent).then(
      () => true,
      () => false,
    );
    if (alive) {
      controller.joinTab(id, room, name);
    } else {
      // The tab predates the extension install/update, so it has no content script. Reload it to inject one.
      controller.expectTab(id, room, name);
      await browser.tabs.reload(id).catch(() => {});
    }
    return { ok: true, reusedTab: true };
  }

  const tab = await browser.tabs.create({ url: 'https://www.youtube.com/' });
  if (tab.id !== undefined) controller.expectTab(tab.id, room, name);
  return { ok: true, reusedTab: false };
}

export function initVibePartyBackground(): void {
  const relayUrl = parseRelayUrl(import.meta.env.WXT_VIBEPARTY_WS_URL);
  if (import.meta.env.WXT_VIBEPARTY_WS_URL && !relayUrl) {
    console.warn('[vibeparty] WXT_VIBEPARTY_WS_URL ignored: it must be wss://… (ws:// only for localhost).');
  }

  // MV3 workers are killed after ~30 s idle. storage.session survives that (but not a browser restart,
  // which is right: the tabs are gone too).
  const session = (browser.storage as { session?: typeof browser.storage.local }).session;
  let persistTimer: ReturnType<typeof setTimeout> | undefined;

  // The relay and controller need each other, so one is created lazily through this ref.
  const ref: { controller?: PartyController } = {};
  const relay = relayUrl
    ? new RelayClient(relayUrl, {
        onOpen: () => ref.controller?.relayOpened(),
        onClose: () => ref.controller?.relayClosed(),
        onMessage: (msg) => ref.controller?.relayMessage(msg),
        onLatency: (ms) => ref.controller?.setLatency(ms),
      })
    : null;

  const controller = new PartyController({
    now: () => Date.now(),
    uuid: () => crypto.randomUUID(),
    send: (tabId, msg) => {
      // A tab with no content script (closed, navigated away) rejects — that's fine, prune() cleans up.
      void browser.tabs.sendMessage(tabId, msg).catch(() => {});
    },
    relay,
    onChange: () => {
      if (!session) return;
      clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        void session.set({ [SESSION_KEY]: controller.serialize() }).catch(() => {});
      }, PERSIST_DEBOUNCE_MS);
    },
  });
  ref.controller = controller;

  // Everything waits for the restore so a message that woke the worker isn't handled against empty state.
  const ready = (async () => {
    try {
      const stored = await session?.get(SESSION_KEY);
      controller.restore(stored?.[SESSION_KEY]);
    } catch {
      /* start clean */
    }
    relay?.start();
  })();

  const extensionOrigin = new URL(browser.runtime.getURL('/newtab.html')).origin;

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (typeof message !== 'object' || message === null) return;
    const type = (message as { type?: unknown }).type;
    if (typeof type !== 'string' || !type.startsWith('vibeparty:')) return;

    // Messages from pact's own pages (new tab) vs. from a YouTube tab's content script.
    if (sender.id === browser.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(`${extensionOrigin}/`)) {
      const app = parseAppMessage(message);
      if (!app) return;
      if (app.type === 'vibeparty:app-status') {
        void ready.then(() => sendResponse(controller.appStatus()));
      } else {
        void ready
          .then(() => openParty(controller, app.room, app.name))
          .then(sendResponse, () => sendResponse({ ok: false, error: 'Couldn’t open YouTube.' } satisfies OpenResult));
      }
      return true; // async response
    }

    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') void ready.then(() => controller.handleContent(tabId, message));
    return;
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void ready.then(() => controller.tabClosed(tabId));
  });

  setInterval(() => controller.prune(), PRUNE_EVERY_MS);
}
