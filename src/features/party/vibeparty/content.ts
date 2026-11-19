/**
 * Runs on youtube.com. Connects four things: the panel (overlay), the "Watch together" button, the player (sync
 * engine) and the party host that owns the party. It holds almost no party state itself — the host does, which
 * is what lets a full-page navigation (playing a queued video) pick up exactly where it left off: a fresh
 * content script says hello and the host hands the party straight back.
 *
 * Starting a party is one click on the button (or the panel): a room code is made here, the invite is copied
 * while the click's permission to use the clipboard is still valid, the tab joins, and the video's current position
 * is put into the room. Invites come back in through the address bar — `…&pact=<code>` — and are only ever
 * *offered*: a link is untrusted input, so nothing joins without a click.
 */
import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { generateRoomCode } from '../roomCode.ts';
import { readInviteCode, withoutInvite } from './invite.ts';
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
import { fetchTitle } from './title.ts';
import { WatchTogetherButton } from './watch-button.ts';

const PING_MS = 20_000;

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
  /** The address bar (the invite link). */
  getHref?(): string;
  /** Rewrite the address bar without navigating (to drop the invite code once read). */
  replaceHref?(href: string): void;
  isWatchPage?(): boolean;
};

export function initVibeParty(ctx?: ContentScriptContext, hooks: ContentHooks = {}): void {
  const videoId = hooks.getVideoId ?? getYouTubeVideoId;
  const navigate = hooks.navigate ?? ((id: string) => location.assign(watchUrlFor(id)));
  const getHref = hooks.getHref ?? (() => location.href);
  const replaceHref =
    hooks.replaceHref ??
    ((href: string) => {
      try {
        history.replaceState(history.state, '', href);
      } catch {
        /* the page owns its history; leaving the code in the address bar is harmless */
      }
    });
  const isWatchPage = hooks.isWatchPage ?? (() => location.pathname === '/watch' && videoId() !== null);
  let joinedRoom: string | null = null;
  /** A party this tab just created: once joined, the video's position goes into the room. */
  let startedRoom: string | null = null;
  let startedAt = 0;
  let people = 0;
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

  const remember = (name: string) => {
    displayName = name;
    void browser.storage.local.set({ [VIBEPARTY_NAME_KEY]: name }).catch(() => {});
  };

  /** One click: new room, invite on the clipboard (while the click's permission lasts), join. */
  const startParty = (typedName?: string) => {
    if (joinedRoom) {
      overlay.reveal();
      return;
    }
    if (startedRoom && Date.now() - startedAt < 4_000) return; // a double click: one party is already on its way
    const name = typedName && typedName !== 'guest' ? typedName : displayName;
    const room = generateRoomCode();
    startedRoom = room;
    startedAt = Date.now();
    remember(name);
    void overlay.copyInvite(room); // first: the clipboard needs the user gesture this call is still inside
    send({ type: 'vibeparty:join', room, name });
  };

  const syncButton = () => button.setState({ inParty: joinedRoom !== null, people });

  const overlay = new VibePartyOverlay({
    onJoin: (room, name) => {
      remember(name);
      send({ type: 'vibeparty:join', room, name });
    },
    onStart: (name) => startParty(name),
    onRetry: () => send({ type: 'vibeparty:retry' }),
    onOpenPact: () => send({ type: 'vibeparty:open-pact' }),
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
      case 'vibeparty:joined': {
        joinedRoom = msg.state.room;
        people = msg.state.peers.length;
        overlay.setSelf(msg.selfId);
        overlay.setRoom(msg.state.room);
        overlay.setLink(msg);
        overlay.setPresence(msg.state.peers);
        overlay.resetChat(msg.state.chat);
        overlay.setQueue(msg.state.queue);
        overlay.setCurrentVideo(videoId());
        engine.setActive(true);
        if (startedRoom === msg.state.room) {
          // We made this party: the room starts where our player is, and the panel opens.
          startedRoom = null;
          const here = engine.currentState();
          if (here) send({ type: 'vibeparty:media', ev: here.ev, mediaTime: here.mediaTime, playing: here.playing, videoId: here.videoId });
          overlay.reveal();
        } else if (msg.state.media) {
          applyMedia(msg.state.media);
        }
        syncButton();
        startPing();
        return;
      }
      case 'vibeparty:left':
        joinedRoom = null;
        startedRoom = null;
        roomVideoId = null;
        people = 0;
        engine.setActive(false);
        stopPing();
        overlay.setRoom(null);
        syncButton();
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
        people = msg.peers.length;
        overlay.setPresence(msg.peers);
        syncButton();
        return;
      case 'vibeparty:status':
        overlay.setLink(msg);
        return;
      case 'vibeparty:error':
        startedRoom = null; // e.g. "that room is full": the next click may try again
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

  /** An invite link (`…&pact=<code>`): take the code out of the address bar and offer it — never join on our own. */
  const checkInvite = () => {
    const code = readInviteCode(getHref());
    if (!code) return;
    replaceHref(withoutInvite(getHref())); // a room code is a password: don't leave it in history
    if (code !== joinedRoom) overlay.setInvite(code);
  };

  // YouTube is a single-page app: moving between videos doesn't reload this script.
  const onNavigate = () => {
    const id = videoId();
    overlay.setCurrentVideo(id);
    overlay.setStartable(id !== null);
    if (roomVideoId && id === roomVideoId) overlay.clearNotice('mismatch');
    button.refresh();
    checkInvite();
  };

  const button = new WatchTogetherButton({ onClick: () => startParty(), isWatchPage });

  browser.runtime.onMessage.addListener(onMessage);
  overlay.mount();
  overlay.setCurrentVideo(videoId());
  overlay.setStartable(videoId() !== null);
  button.mount();
  document.addEventListener('yt-navigate-finish', onNavigate);
  checkInvite();

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
    button.unmount();
    overlay.unmount();
  });
}
