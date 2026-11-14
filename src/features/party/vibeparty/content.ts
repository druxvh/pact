/**
 * Runs on youtube.com. Connects three things: the panel (overlay), the player (sync engine) and the
 * background script that owns the party. It holds almost no party state itself — the background does, which
 * is what lets a full-page navigation (playing a queued video) pick up exactly where it left off: a fresh
 * content script says hello and the background hands the party straight back.
 */
import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { type OverlayPrefs, VibePartyOverlay } from './overlay.ts';
import {
  type BackgroundToContent,
  type ContentToBackground,
  type MediaSnapshot,
  parseYouTubeId,
  VIBEPARTY_NAME_KEY,
  VIBEPARTY_PREFS_KEY,
  watchUrlFor,
} from './protocol.ts';
import { getYouTubeVideoId, SyncEngine } from './sync-engine.ts';

const PING_MS = 20_000;
const TITLE_TIMEOUT_MS = 3_000;

/** YouTube's own oEmbed endpoint — same-origin from here, so no extra permission and no third party involved. */
async function fetchTitle(videoId: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS);
  try {
    const res = await fetch(`/oembed?url=${encodeURIComponent(watchUrlFor(videoId))}&format=json`, { signal: controller.signal, credentials: 'omit' });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: unknown };
    return typeof data.title === 'string' ? data.title.trim() || null : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const currentTitle = () =>
  document.title
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\s*-\s*YouTube$/, '')
    .trim();

function readPrefs(raw: unknown): OverlayPrefs {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<OverlayPrefs>;
  return { collapsed: p.collapsed === true, autoFollow: p.autoFollow === true };
}

/** Seams for the dev harness (dev/vibeparty-harness.html) and tests; the extension passes nothing. */
export type ContentHooks = {
  getVideoId?(): string | null;
  navigate?(videoId: string): void;
};

export function initVibeParty(ctx?: ContentScriptContext, hooks: ContentHooks = {}): void {
  const videoId = hooks.getVideoId ?? getYouTubeVideoId;
  const navigate = hooks.navigate ?? ((id: string) => location.assign(watchUrlFor(id)));
  let joinedRoom: string | null = null;
  let displayName = 'guest';
  let roomVideoId: string | null = null;
  let prefs: OverlayPrefs = { collapsed: false, autoFollow: false };
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let dead = false;

  const send = (message: ContentToBackground) => {
    if (dead) return;
    try {
      void browser.runtime.sendMessage(message).catch(() => {});
    } catch {
      dead = true; // "Extension context invalidated" — the extension was reloaded under us
    }
  };

  const goTo = (id: string) => {
    if (videoId() !== id) navigate(id);
  };

  const overlay = new VibePartyOverlay({
    onJoin: (room, name) => {
      displayName = name;
      void browser.storage.local.set({ [VIBEPARTY_NAME_KEY]: name }).catch(() => {});
      send({ type: 'vibeparty:join', room, name });
    },
    onLeave: () => send({ type: 'vibeparty:leave' }),
    onChat: (text) => send({ type: 'vibeparty:chat', text }),
    onReaction: (emoji, messageId) => send({ type: 'vibeparty:reaction', emoji, messageId }),
    onQueueAdd: async (input) => {
      const id = parseYouTubeId(input);
      if (!id) return 'That doesn’t look like a YouTube link.';
      const title = (await fetchTitle(id)) ?? id;
      send({ type: 'vibeparty:queue:add', url: watchUrlFor(id), title });
      return null;
    },
    onQueueAddCurrent: async () => {
      const id = videoId();
      if (!id) return 'Open a video first.';
      const title = currentTitle() || (await fetchTitle(id)) || id;
      send({ type: 'vibeparty:queue:add', url: watchUrlFor(id), title });
      return null;
    },
    onQueueVote: (id) => send({ type: 'vibeparty:queue:vote', id }),
    onQueueRemove: (id) => send({ type: 'vibeparty:queue:remove', id }),
    onQueuePlay: goTo,
    onFollow: goTo,
    onPrefsChange: (next) => {
      prefs = next;
      void browser.storage.local.set({ [VIBEPARTY_PREFS_KEY]: next }).catch(() => {});
    },
  });

  const engine = new SyncEngine({
    getVideoId: videoId,
    onLocalEvent: (e) => {
      if (e.ev === 'play') overlay.clearNotice('blocked');
      overlay.clearNotice('mismatch'); // the viewer is steering now
      send({ type: 'vibeparty:media', ev: e.ev, mediaTime: e.mediaTime, playing: e.playing, videoId: e.videoId });
    },
    onVideoMismatch: (videoId) => {
      if (prefs.autoFollow) goTo(videoId);
      else overlay.setNotice({ kind: 'mismatch', videoId });
    },
    onAdChange: (showing) => (showing ? overlay.setNotice({ kind: 'ad' }) : overlay.clearNotice('ad')),
    onNeedResync: () => send({ type: 'vibeparty:resync' }),
    onPlayBlocked: () => overlay.setNotice({ kind: 'blocked' }),
  });

  const applyMedia = (media: MediaSnapshot) => {
    roomVideoId = media.videoId;
    const local = videoId();
    // The queue moved on: everyone goes to the next video, no questions asked.
    if (media.reason === 'advance' && media.videoId && media.videoId !== local) {
      goTo(media.videoId);
      return;
    }
    if (!media.videoId || media.videoId === local) overlay.clearNotice('mismatch');
    engine.applyRemote({ playing: media.playing, mediaTime: media.mediaTime, videoId: media.videoId });
  };

  const onMessage = (message: unknown, _sender: unknown, sendResponse: (response?: unknown) => void) => {
    const msg = message as BackgroundToContent | null;
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('vibeparty:')) return;

    switch (msg.type) {
      case 'vibeparty:probe':
        sendResponse({ ok: true });
        return;
      case 'vibeparty:joined':
        joinedRoom = msg.state.room;
        overlay.setSelf(msg.selfId);
        overlay.setRoom(msg.state.room);
        overlay.setMode(msg.mode);
        overlay.setPresence(msg.state.peers);
        overlay.resetChat(msg.state.chat);
        overlay.setQueue(msg.state.queue);
        overlay.setCurrentVideo(videoId());
        engine.setActive(true);
        if (msg.state.media) applyMedia(msg.state.media);
        startPing();
        return;
      case 'vibeparty:left':
        joinedRoom = null;
        roomVideoId = null;
        engine.setActive(false);
        stopPing();
        overlay.setRoom(null);
        return;
      case 'vibeparty:media':
        if (joinedRoom) applyMedia(msg.media);
        return;
      case 'vibeparty:chat':
        overlay.pushChat(msg.message);
        return;
      case 'vibeparty:reaction':
        overlay.spawnReaction(msg.reaction);
        return;
      case 'vibeparty:queue':
        overlay.setQueue(msg.items);
        return;
      case 'vibeparty:presence':
        overlay.setPresence(msg.peers);
        return;
      case 'vibeparty:status':
        overlay.setMode(msg.mode);
        return;
      case 'vibeparty:error':
        overlay.flash('error', msg.message);
        return;
      default:
        return;
    }
  };

  const startPing = () => {
    if (pingTimer) return;
    pingTimer = setInterval(() => {
      if (joinedRoom) send({ type: 'vibeparty:ping', room: joinedRoom, name: displayName });
    }, PING_MS);
  };
  const stopPing = () => {
    clearInterval(pingTimer);
    pingTimer = undefined;
  };

  // YouTube is a single-page app: moving between videos doesn't reload this script.
  const onNavigate = () => {
    const id = videoId();
    overlay.setCurrentVideo(id);
    if (roomVideoId && id === roomVideoId) overlay.clearNotice('mismatch');
  };

  browser.runtime.onMessage.addListener(onMessage);
  overlay.mount();
  overlay.setCurrentVideo(videoId());
  document.addEventListener('yt-navigate-finish', onNavigate);

  void browser.storage.local
    .get([VIBEPARTY_PREFS_KEY, VIBEPARTY_NAME_KEY])
    .then((stored) => {
      prefs = readPrefs(stored[VIBEPARTY_PREFS_KEY]);
      overlay.setPrefs(prefs);
      const name = stored[VIBEPARTY_NAME_KEY];
      if (typeof name === 'string' && name.trim()) {
        displayName = name.trim();
        overlay.setSavedName(displayName);
      }
    })
    .catch(() => {});

  // Tell the background we exist. If this tab is already in a party (we just navigated), it hands the party back.
  send({ type: 'vibeparty:hello' });

  ctx?.onInvalidated(() => {
    dead = true;
    browser.runtime.onMessage.removeListener(onMessage);
    document.removeEventListener('yt-navigate-finish', onNavigate);
    stopPing();
    engine.dispose();
    overlay.unmount();
  });
}
