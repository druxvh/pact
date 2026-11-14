import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { BackgroundToContent, ContentToBackground, PendingRoom, QueueItem } from './protocol';
import { VIBEPARTY_PENDING_KEY } from './protocol';
import { SyncEngine } from './sync-engine';
import { VibePartyOverlay } from './overlay';

const PING_MS = 20_000;
const PENDING_TTL_MS = 30 * 60_000;

export function initVibeParty(ctx?: ContentScriptContext): void {
  let joinedRoom: string | null = null;
  let displayName = 'guest';
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let chatFocused = false;
  let localQueue: QueueItem[] = [];

  const send = (message: ContentToBackground) => {
    try {
      void browser.runtime.sendMessage(message);
    } catch {
      // extension context invalidated during reload
    }
  };

  const overlay = new VibePartyOverlay({
    onJoin: (room, name) => {
      displayName = name;
      send({ type: 'vibeparty:join', room, name });
    },
    onLeave: () => {
      send({ type: 'vibeparty:leave' });
    },
    onChat: (text) => {
      send({ type: 'vibeparty:chat', text });
    },
    onReaction: (emoji, messageId) => {
      send({ type: 'vibeparty:reaction', emoji, messageId });
    },
    onQueueAdd: (url, title) => {
      send({ type: 'vibeparty:queue:add', url, title });
    },
    onQueueVote: (id) => {
      send({ type: 'vibeparty:queue:vote', id });
    },
    onQueuePlay: (videoId) => {
      location.href = `https://www.youtube.com/watch?v=${videoId}`;
    },
  });

  const engine = new SyncEngine({
    onLocalEvent: (event) => {
      if (!joinedRoom) return;
      if (event.ev === 'state') return;
      send({
        type: 'vibeparty:media',
        ev: event.ev,
        mediaTime: event.mediaTime,
        playing: event.playing,
        videoId: event.videoId,
      });
    },
  });

  const onMessage = (message: BackgroundToContent) => {
    if (!message || typeof message.type !== 'string' || !message.type.startsWith('vibeparty:')) {
      return;
    }
    switch (message.type) {
      case 'vibeparty:joined': {
        joinedRoom = message.state.room;
        overlay.setSelf(message.selfId);
        overlay.setRoom(message.state.room);
        overlay.setPresence(message.state.peers);
        overlay.setQueue(message.state.queue);
        localQueue = [...message.state.queue]; // Initialize local queue sync
        for (const item of message.state.chat) overlay.pushChat(item);
        overlay.setStatus(
          message.state.room ? `synced in #${message.state.room}` : 'offline — local only',
          true,
        );
        if (message.state.media) {
          if (!chatFocused) {
            engine.applyRemote({
              playing: message.state.media.playing,
              mediaTime: message.state.media.mediaTime,
              serverTime: message.state.media.serverTime,
              videoId: message.state.media.videoId,
            });
          }
        }
        startPing();
        break;
      }
      case 'vibeparty:left': {
        joinedRoom = null;
        overlay.setRoom(null);
        overlay.setStatus('offline — local only', false);
        overlay.setPresence([]);
        stopPing();
        break;
      }
      case 'vibeparty:media': {
        if (!joinedRoom) return;
        if (!chatFocused) {
          engine.applyRemote({
            playing: message.playing,
            mediaTime: message.mediaTime,
            serverTime: message.serverTime,
            videoId: message.videoId,
          });
        }
        break;
      }
      case 'vibeparty:chat':
        overlay.pushChat(message.message);
        break;
      case 'vibeparty:reaction':
        overlay.spawnReaction(message.reaction);
        break;
      case 'vibeparty:queue': {
      // Merge new queue items with existing, using item id as key to prevent overwrites
      const existingIds = new Set(localQueue.map((item) => item.id));
      const merged = [...message.items].filter((item) => !existingIds.has(item.id));
      localQueue = [...localQueue, ...merged]
        .sort((a, b) => {
          const votes = b.voters.length - a.voters.length;
          if (votes !== 0) return votes;
          return a.createdAt - b.createdAt;
        });
      overlay.setQueue(localQueue);
      break;
    }
      case 'vibeparty:presence':
        overlay.setPresence(message.peers);
        break;
      case 'vibeparty:status':
        overlay.setStatus(
          message.connected
            ? `live server${message.room ? ` · #${message.room}` : ''}`
            : message.room
              ? `local hub · #${message.room}`
              : 'offline — local only',
          message.connected,
        );
        break;
      case 'vibeparty:error':
        overlay.setStatus(message.message, false);
        break;
      default:
        break;
    }
  };

  const startPing = () => {
    if (pingTimer) return;
    pingTimer = setInterval(() => {
      if (joinedRoom) send({ type: 'vibeparty:ping', room: joinedRoom, name: displayName });
    }, PING_MS);
  };

  const stopPing = () => {
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
  };

  browser.runtime.onMessage.addListener(onMessage);
  overlay.mount();
  engine.start();

  // Suspend sync when chat input is focused to prevent YouTube being controlled
  // while the user is typing in chat
  const chatInput = overlay.getHost()?.shadowRoot?.querySelector('input.vp-input');
  if (chatInput) {
    chatInput.addEventListener('focus', () => {
      chatFocused = true;
      engine.suspend();
    });
    chatInput.addEventListener('blur', () => {
      chatFocused = false;
      engine.resume();
    });
  }

  void browser.storage.local
    .get(VIBEPARTY_PENDING_KEY)
    .then((stored) => {
      const pending = stored[VIBEPARTY_PENDING_KEY] as PendingRoom | undefined;
      if (!pending?.room) return;
      void browser.storage.local.remove(VIBEPARTY_PENDING_KEY);
      if (!pending.at || Date.now() - pending.at > PENDING_TTL_MS) return;
      displayName = pending.name || 'guest';
      send({ type: 'vibeparty:join', room: pending.room, name: displayName });
    })
    .catch(() => {});

  ctx?.onInvalidated(() => {
    browser.runtime.onMessage.removeListener(onMessage);
    stopPing();
    engine.dispose();
    overlay.unmount();
    if (joinedRoom) send({ type: 'vibeparty:leave' });
  });
}
