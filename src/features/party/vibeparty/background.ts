/**
 * The service worker's share of VibeParty: a thin router. It holds no party state and no connection.
 *
 *   YouTube tab ──content script──▶ service worker ──runtime messages──▶ party host ──Realtime──▶ the room
 *                                         ▲                                   │
 *                                         └──────────── deliver(tab, msg) ◀───┘
 *
 * Why not run the party in the service worker? It needs the user's Supabase session, which lives in `localStorage` — and a
 * service worker has none — and an MV3 worker is torn down when idle, which would drop the connection mid-movie. The host
 * (host.ts) runs in a long-lived extension page instead: an offscreen document in Chromium (created when a party starts,
 * closed when it has been idle for a while), or this very background page in Firefox. What only the worker can do stays
 * here: the `tabs` API (find / open / reload a YouTube tab, deliver messages to content scripts).
 */
import { browser } from 'wxt/browser';
import type { PartyHost } from './host.ts';
import type { AppStatus, BackgroundToContent, HostCommand, OpenResult } from './protocol.ts';
import { cleanName, cleanRoom, parseAppMessage, parseContentMessage } from './sanitize.ts';

const HOST_PATH = '/party-host.html';
/** storage.session: is a party (or one about to start) expected? Lets a content script's `hello` be ignored when there is nothing to restore. */
const WANTED_KEY = 'vibeparty:host-wanted';

const getUrl = (path: string) => (browser.runtime.getURL as (p: string) => string)(path);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── talking to the host ──────────────────────────────────────────────────────

type SendOptions = { /** false = don't start a host just for this (it would have nothing to say). */ create?: boolean };

export type HostBridge = {
  send<T = unknown>(cmd: HostCommand, options?: SendOptions): Promise<T | undefined>;
  /** Stop the host (it has been idle). */
  close(): Promise<void>;
};

type OffscreenApi = {
  createDocument(options: { url: string; reasons: string[]; justification: string }): Promise<void>;
  closeDocument(): Promise<void>;
};

/** Chromium: the host is an offscreen document. */
function offscreenBridge(offscreen: OffscreenApi | undefined): HostBridge {
  let known = false;
  let creating: Promise<boolean> | null = null;

  const exists = async (): Promise<boolean> => {
    try {
      const contexts = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as never] });
      return contexts.length > 0;
    } catch {
      return false;
    }
  };
  const ping = async (): Promise<boolean> => {
    try {
      const reply = (await browser.runtime.sendMessage({ type: 'vibeparty-host:ping' } satisfies HostCommand)) as { ok?: boolean } | undefined;
      return reply?.ok === true;
    } catch {
      return false; // no receiver: no host (yet)
    }
  };

  /** Make sure a host exists and answers. */
  const ensure = (): Promise<boolean> => {
    creating ??= (async () => {
      if (await ping()) return true;
      if (!offscreen) return false;
      if (!(await exists())) {
        try {
          await offscreen.createDocument({
            url: HOST_PATH,
            reasons: ['LOCAL_STORAGE'],
            justification:
              'Holds the watch-party connection. It needs the signed-in session, which is kept in this extension’s localStorage (not available to the service worker), and must stay alive while a party is running.',
          });
        } catch (err) {
          // Another call created it a moment ago — fine; anything else is a real failure.
          if (!/single|already|exists/i.test(err instanceof Error ? err.message : String(err))) return false;
        }
      }
      for (let i = 0; i < 50; i++) {
        if (await ping()) return true;
        await sleep(100);
      }
      return false;
    })().finally(() => {
      creating = null;
    });
    return creating;
  };

  return {
    async send<T>(cmd: HostCommand, { create = true }: SendOptions = {}) {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (!known) {
          if (!(create ? await ensure() : await exists())) {
            if (!create) return undefined;
            continue; // e.g. the host was being closed as we asked: look again, it can be created now
          }
          known = true;
        }
        try {
          return (await browser.runtime.sendMessage(cmd)) as T | undefined;
        } catch {
          known = false; // the host went away (or isn't listening yet): look again
        }
      }
      return undefined;
    },
    async close() {
      known = false;
      await offscreen?.closeDocument().catch(() => {});
    },
  };
}

/** Firefox (and anything without offscreen documents): the host runs right here, in the persistent background page. */
function inProcessBridge(deliver: (tabId: number, msg: BackgroundToContent) => void): HostBridge {
  let host: Promise<PartyHost> | null = null;
  const get = (): Promise<PartyHost> => {
    host ??= import('./host-page.ts').then(({ createPageHost }) => {
      const created = createPageHost(deliver);
      created.start();
      return created;
    });
    return host;
  };
  return {
    async send<T>(cmd: HostCommand) {
      return (await get()).handle(cmd) as T | undefined;
    },
    async close() {},
  };
}

// ── the worker ───────────────────────────────────────────────────────────────

const deliverToTab = (tabId: number, msg: BackgroundToContent) => {
  // A tab with no content script (closed, navigated away) rejects — that's fine, the host's prune() cleans up.
  void browser.tabs.sendMessage(tabId, msg).catch(() => {});
};

/**
 * Reuse an open YouTube tab if there is one (preferring a watch page), otherwise open a new one.
 * Either way the tab is joined to the room — no hand-off through storage, no race between two tabs.
 */
async function openParty(bridge: HostBridge, rawRoom: string, rawName: string): Promise<OpenResult> {
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
      const ok = await bridge.send<{ ok: true }>({ type: 'vibeparty-host:join-tab', tabId: id, room, name });
      if (!ok) return { ok: false, error: 'Couldn’t start the party. Try again in a moment.' };
    } else {
      // The tab predates the extension install/update, so it has no content script. Reload it to inject one.
      const ok = await bridge.send<{ ok: true }>({ type: 'vibeparty-host:expect-tab', tabId: id, room, name });
      if (!ok) return { ok: false, error: 'Couldn’t start the party. Try again in a moment.' };
      await browser.tabs.reload(id).catch(() => {});
    }
    return { ok: true, reusedTab: true };
  }

  const tab = await browser.tabs.create({ url: 'https://www.youtube.com/' });
  if (tab.id !== undefined) {
    const ok = await bridge.send<{ ok: true }>({ type: 'vibeparty-host:expect-tab', tabId: tab.id, room, name });
    if (!ok) return { ok: false, error: 'Couldn’t start the party. Try again in a moment.' };
  }
  return { ok: true, reusedTab: false };
}

export function initVibePartyBackground(): void {
  const offscreen = (browser as unknown as { offscreen?: OffscreenApi }).offscreen;
  const session = (browser.storage as { session?: typeof browser.storage.local }).session;
  // Decided at build time, so the Supabase client and the host never enter the service worker's bundle on Chromium.
  const bridge: HostBridge = import.meta.env.MANIFEST_VERSION === 2 ? inProcessBridge(deliverToTab) : offscreenBridge(offscreen);
  const extensionOrigin = new URL(getUrl('/newtab.html')).origin;

  let wanted: boolean | undefined;
  const isWanted = async (): Promise<boolean> => {
    if (wanted !== undefined) return wanted;
    try {
      wanted = (await session?.get(WANTED_KEY))?.[WANTED_KEY] === true;
    } catch {
      wanted = false;
    }
    return wanted;
  };
  const setWanted = async (value: boolean): Promise<void> => {
    wanted = value;
    try {
      await session?.set({ [WANTED_KEY]: value });
    } catch {
      /* in-memory only */
    }
  };

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (typeof message !== 'object' || message === null) return;
    const type = (message as { type?: unknown }).type;
    if (typeof type !== 'string') return;
    const fromExtension = sender.id === browser.runtime.id && !sender.tab;

    // From the host: a message for a YouTube tab, or "I've been idle".
    if (type === 'vibeparty-host:deliver') {
      const { tabId, msg } = message as { tabId?: unknown; msg?: { type?: unknown } };
      if (fromExtension && typeof tabId === 'number' && typeof msg?.type === 'string' && msg.type.startsWith('vibeparty:'))
        deliverToTab(tabId, msg as BackgroundToContent);
      return;
    }
    if (type === 'vibeparty-host:idle') {
      // Only close it if it still says it is idle: a party may have started since it sent this.
      if (fromExtension) {
        void bridge.send<AppStatus>({ type: 'vibeparty-host:status' }, { create: false }).then(async (status) => {
          if (status && !status.idle) return;
          await setWanted(false);
          await bridge.close();
        });
      }
      return;
    }
    if (!type.startsWith('vibeparty:')) return;

    // From pact's own pages (new tab) …
    if (sender.id === browser.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(`${extensionOrigin}/`)) {
      const app = parseAppMessage(message);
      if (!app) return;
      if (app.type === 'vibeparty:app-status') {
        // Don't start a host just to answer "is anything running?".
        void bridge
          .send<AppStatus>({ type: 'vibeparty-host:status' }, { create: false })
          .then((status) => sendResponse(status ?? ({ online: false, hostRunning: false, idle: true, rooms: [] } satisfies AppStatus)));
      } else if (app.type === 'vibeparty:retry') {
        void bridge.send({ type: 'vibeparty-host:retry' }, { create: false }).then(() => sendResponse({ ok: true }));
      } else {
        void setWanted(true)
          .then(() => openParty(bridge, app.room, app.name))
          .then(sendResponse, () => sendResponse({ ok: false, error: 'Couldn’t open YouTube.' } satisfies OpenResult));
      }
      return true; // async response
    }

    // … or from a YouTube tab's content script.
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number' || sender.id !== browser.runtime.id) return;
    const content = parseContentMessage(message);
    if (!content) return;
    if (content.type === 'vibeparty:open-pact') {
      void browser.tabs.create({ url: `${getUrl('/newtab.html')}#/party` }).catch(() => {});
      return;
    }
    // Only a join / keep-alive may start a host; a page that merely says hello gets one only if a party is expected.
    const starts = content.type === 'vibeparty:join' || content.type === 'vibeparty:ping';
    void (async () => {
      if (starts) await setWanted(true);
      await bridge.send({ type: 'vibeparty-host:content', tabId, message }, { create: starts || (await isWanted()) });
    })();
    return;
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    void bridge.send({ type: 'vibeparty-host:tab-closed', tabId }, { create: false });
  });
}
