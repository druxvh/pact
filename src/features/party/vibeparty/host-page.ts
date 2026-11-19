/**
 * Runs the party host inside a real extension page — the one place that can hold both of the things a live party needs:
 *   • the Supabase session (it lives in this origin's `localStorage`, shared with pact's new-tab page), and
 *   • a connection that is not torn down after 30 s of idleness (an MV3 service worker is).
 *
 * Chromium: the page is an offscreen document (`/party-host.html`, reason LOCAL_STORAGE) that the service worker creates
 * when a party starts and closes after the last one ends. Firefox (MV2) has a persistent background page, which *is* such
 * a page, so `createPageHost` is simply called from there.
 *
 * The Supabase client is the same module pact's pages use (`@/lib/supabase/client`), so a sign-in or sign-out anywhere
 * reaches the host through supabase-js's own cross-context sync, and token refreshes are coordinated by its lock.
 */
import { browser } from 'wxt/browser';
import { parseHostCommand as parseNowPlayingCommand } from '@/features/nowplaying/protocol.ts';
import { pagePublisher } from '@/features/nowplaying/publisher-page.ts';
import { supabase } from '@/lib/supabase/client';
import { PartyHost, type PartyHostDeps } from './host.ts';
import type { HostEvent } from './protocol.ts';
import { VIBEPARTY_CLIENT_KEY, VIBEPARTY_HOST_STATE_KEY } from './protocol.ts';
import type { RealtimeLike } from './realtime-client.ts';
import { parseHostCommand } from './sanitize.ts';

const CLIENT_ID = /^[\w-]{8,64}$/;
/** With no party for this long, ask the service worker to close the host (offscreen documents cost memory). */
export const IDLE_CLOSE_MS = 2 * 60_000;
const IDLE_CHECK_MS = 30_000;
/** Refresh the session while a party runs even if no pact page is open (supabase-js stops its own timer in hidden documents). */
const SESSION_KEEPALIVE_MS = 4 * 60_000;

/** This browser profile's identity in Presence: random, created once, stable across restarts of the host. */
export function stableClientId(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): string {
  try {
    const existing = storage?.getItem(VIBEPARTY_CLIENT_KEY);
    if (existing && CLIENT_ID.test(existing)) return existing;
  } catch {
    /* fall through to a fresh id */
  }
  const id = crypto.randomUUID();
  try {
    storage?.setItem(VIBEPARTY_CLIENT_KEY, id);
  } catch {
    /* unavailable: the id is stable for this page's lifetime only */
  }
  return id;
}

function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** Build the host for this page. `deliver` is how a message reaches a YouTube tab from here. */
export function createPageHost(deliver: PartyHostDeps['deliver']): PartyHost {
  const store = safeStorage();
  return new PartyHost({
    // supabase-js's client satisfies the structural subset the transport needs; the cast is the one seam between them.
    client: supabase as unknown as RealtimeLike | null,
    clientId: stableClientId(store),
    uuid: () => crypto.randomUUID(),
    deliver,
    storage: {
      load: () => {
        try {
          const raw = store?.getItem(VIBEPARTY_HOST_STATE_KEY);
          return raw ? JSON.parse(raw) : undefined;
        } catch {
          return undefined;
        }
      },
      save: (state) => store?.setItem(VIBEPARTY_HOST_STATE_KEY, JSON.stringify(state)),
    },
  });
}

/** Entry point of the offscreen document. */
export function startHostPage(): PartyHost {
  const send = (event: HostEvent) => {
    void browser.runtime.sendMessage(event).catch(() => {});
  };
  const host = createPageHost((tabId, msg) => send({ type: 'vibeparty-host:deliver', tabId, msg }));
  host.start();

  // The "Now playing" publisher lives in this page too (it needs the same session and the same long-lived page).
  const publisher = pagePublisher();

  // Only the service worker (or another page of this extension) talks to the host; a content script never reaches it.
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== browser.runtime.id || sender.tab) return;
    const nowPlaying = parseNowPlayingCommand(message);
    if (nowPlaying) {
      void publisher.handle(nowPlaying).then(sendResponse, () => sendResponse('error'));
      return true; // async response
    }
    const cmd = parseHostCommand(message);
    if (!cmd) return;
    const result = host.handle(cmd);
    if (result !== undefined) sendResponse(result);
    return;
  });

  // Keep the session fresh while a party runs or a track is shared, whether or not any pact page is open.
  void supabase?.auth.startAutoRefresh().catch(() => {});
  setInterval(() => {
    if (!host.controller.idle || publisher.active) void supabase?.auth.getSession().catch(() => {});
  }, SESSION_KEEPALIVE_MS);

  let idleSince: number | null = null;
  setInterval(() => {
    if (!host.controller.idle) {
      idleSince = null;
      return;
    }
    idleSince ??= Date.now();
    if (Date.now() - idleSince >= IDLE_CLOSE_MS) send({ type: 'vibeparty-host:idle' });
  }, IDLE_CHECK_MS);

  window.addEventListener('pagehide', () => host.stop());
  return host;
}
