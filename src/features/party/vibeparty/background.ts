import { browser } from 'wxt/browser';
import type {
  AppStatus,
  ChatMessage,
  ContentToBackground,
  MediaSnapshot,
  PeerInfo,
  QueueItem,
  ReactionEvent,
  RoomState,
  WireMessage,
} from './protocol';
import { parseYouTubeId } from './protocol';

type TabMember = {
  peerId: string;
  name: string;
};

type RoomHub = {
  peers: Map<number, TabMember>;
  queue: QueueItem[];
  chat: ChatMessage[];
  media: MediaSnapshot | null;
};

const HEARTBEAT_MS = 25_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const CHAT_CAP = 200;

const rooms = new Map<string, RoomHub>();
let socket: WebSocket | null = null;
let socketUrl = '';
let reconnectAttempts = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let socketConnected = false;

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function getHub(room: string): RoomHub {
  let hub = rooms.get(room);
  if (!hub) {
    hub = { peers: new Map(), queue: [], chat: [], media: null };
    rooms.set(room, hub);
  }
  return hub;
}

function roomOfTab(tabId: number): { room: string; hub: RoomHub } | null {
  for (const [room, hub] of rooms) {
    if (hub.peers.has(tabId)) return { room, hub };
  }
  return null;
}

function sortedQueue(queue: QueueItem[]): QueueItem[] {
  return [...queue].sort((a, b) => {
    const votes = b.voters.length - a.voters.length;
    if (votes !== 0) return votes;
    return a.createdAt - b.createdAt;
  });
}

function presenceOf(hub: RoomHub): PeerInfo[] {
  const seen = new Map<string, PeerInfo>();
  for (const member of hub.peers.values()) {
    seen.set(member.peerId, { id: member.peerId, name: member.name });
  }
  return [...seen.values()];
}

function extrapolateMedia(hub: RoomHub): MediaSnapshot | null {
  const media = hub.media;
  if (!media) return null;
  const elapsed = (Date.now() - media.serverTime) / 1000;
  return {
    ...media,
    mediaTime: media.playing ? Math.max(0, media.mediaTime + elapsed) : media.mediaTime,
    serverTime: Date.now(),
  };
}

async function sendToTab(tabId: number, message: unknown): Promise<void> {
  try {
    await browser.tabs.sendMessage(tabId, message);
  } catch {
    // tab may not have the content script (other extension pages)
  }
}

function broadcastRoom(
  hub: RoomHub,
  message: Record<string, unknown>,
  exceptTabId?: number,
): void {
  for (const tabId of hub.peers.keys()) {
    if (tabId === exceptTabId) continue;
    void sendToTab(tabId, message);
  }
}

function broadcastPresence(hub: RoomHub): void {
  broadcastRoom(hub, { type: 'vibeparty:presence', peers: presenceOf(hub) });
}

function broadcastQueue(hub: RoomHub): void {
  hub.queue = sortedQueue(hub.queue);
  broadcastRoom(hub, { type: 'vibeparty:queue', items: hub.queue });
}

function broadcastMedia(
  hub: RoomHub,
  fromTabId: number | undefined,
  fromPeerId: string,
): void {
  const media = extrapolateMedia(hub);
  if (!media) return;
  for (const [tabId, member] of hub.peers) {
    if (tabId === fromTabId) continue;
    if (member.peerId === fromPeerId) continue;
    void sendToTab(tabId, {
      type: 'vibeparty:media',
      from: fromPeerId,
      playing: media.playing,
      mediaTime: media.mediaTime,
      serverTime: media.serverTime,
      videoId: media.videoId,
    });
  }
}

function leaveRoom(tabId: number): void {
  const found = roomOfTab(tabId);
  if (!found) return;
  const { room, hub } = found;
  const member = hub.peers.get(tabId);
  hub.peers.delete(tabId);
  if (member && socketConnected) {
    socketSend({ t: 'leave', room, peerId: member.peerId });
  }
  void sendToTab(tabId, { type: 'vibeparty:left' });
  if (hub.peers.size === 0) {
    rooms.delete(room);
  } else {
    broadcastPresence(hub);
  }
}

function joinRoom(tabId: number, room: string, name: string): void {
  const existing = roomOfTab(tabId);
  if (existing && existing.room !== room) leaveRoom(tabId);
  const hub = getHub(room);
  const peerId = uuid();
  const member: TabMember = { peerId, name };
  hub.peers.set(tabId, member);
  const state: RoomState = {
    room,
    peers: presenceOf(hub),
    queue: sortedQueue(hub.queue),
    chat: hub.chat.slice(-CHAT_CAP),
    media: extrapolateMedia(hub),
  };
  void sendToTab(tabId, { type: 'vibeparty:joined', state, selfId: peerId });
  broadcastPresence(hub);
  if (socketConnected) {
    socketSend({ t: 'join', room, peerId, name });
  }
}

function handleMediaOp(
  tabId: number,
  msg: Extract<ContentToBackground, { type: 'vibeparty:media' }>,
): void {
  const found = roomOfTab(tabId);
  if (!found) return;
  const { room, hub } = found;
  const member = hub.peers.get(tabId);
  if (!member) return;
  if (msg.ev === 'state' && hub.media && hub.media.controllerPeerId !== member.peerId) return;
  const playing =
    msg.ev === 'play' ? true : msg.ev === 'pause' || msg.ev === 'ended' ? false : msg.playing;
  hub.media = {
    playing,
    mediaTime: msg.mediaTime,
    serverTime: Date.now(),
    videoId: msg.videoId,
    controllerPeerId: member.peerId,
  };
  if (socketConnected) {
    socketSend({
      t: 'media',
      room,
      peerId: member.peerId,
      ev: msg.ev,
      mediaTime: msg.mediaTime,
      videoId: msg.videoId,
    });
  }
  broadcastMedia(hub, tabId, member.peerId);
}

function handleChatOp(tabId: number, msg: Extract<ContentToBackground, { type: 'vibeparty:chat' }>): void {
  const found = roomOfTab(tabId);
  if (!found) return;
  const { room, hub } = found;
  const member = hub.peers.get(tabId);
  if (!member) return;
  const message: ChatMessage = {
    id: uuid(),
    peerId: member.peerId,
    name: member.name,
    text: msg.text.slice(0, 500),
    at: Date.now(),
  };
  hub.chat.push(message);
  if (hub.chat.length > CHAT_CAP) hub.chat = hub.chat.slice(-CHAT_CAP);
  broadcastRoom(hub, { type: 'vibeparty:chat', message });
  if (socketConnected) {
    socketSend({
      t: 'chat',
      room,
      peerId: member.peerId,
      name: member.name,
      text: message.text,
      id: message.id,
      at: message.at,
    });
  }
}

function handleReactionOp(
  tabId: number,
  msg: Extract<ContentToBackground, { type: 'vibeparty:reaction' }>,
): void {
  const found = roomOfTab(tabId);
  if (!found) return;
  const { room, hub } = found;
  const member = hub.peers.get(tabId);
  if (!member) return;
  const reaction: ReactionEvent = {
    id: uuid(),
    peerId: member.peerId,
    name: member.name,
    emoji: msg.emoji.slice(0, 8),
    messageId: msg.messageId,
    at: Date.now(),
  };
  broadcastRoom(hub, { type: 'vibeparty:reaction', reaction }, tabId);
  if (socketConnected) {
    socketSend({
      t: 'reaction',
      room,
      peerId: member.peerId,
      name: member.name,
      emoji: reaction.emoji,
      messageId: reaction.messageId,
      id: reaction.id,
      at: reaction.at,
    });
  }
}

function handleQueueAdd(
  tabId: number,
  msg: Extract<ContentToBackground, { type: 'vibeparty:queue:add' }>,
): void {
  const found = roomOfTab(tabId);
  if (!found) return;
  const { room, hub } = found;
  const member = hub.peers.get(tabId);
  if (!member) return;
  const item: QueueItem = {
    id: uuid(),
    url: msg.url,
    videoId: extractVideoId(msg.url),
    title: msg.title.slice(0, 120),
    addedBy: member.peerId,
    addedByName: member.name,
    voters: [member.peerId],
    createdAt: Date.now(),
  };
  hub.queue.push(item);
  broadcastQueue(hub);
  if (socketConnected) {
    socketSend({ t: 'queue:add', room, peerId: member.peerId, item });
  }
}

function handleQueueVote(
  tabId: number,
  msg: Extract<ContentToBackground, { type: 'vibeparty:queue:vote' }>,
): void {
  const found = roomOfTab(tabId);
  if (!found) return;
  const { room, hub } = found;
  const member = hub.peers.get(tabId);
  if (!member) return;
  const item = hub.queue.find((q) => q.id === msg.id);
  if (!item) return;
  const idx = item.voters.indexOf(member.peerId);
  if (idx >= 0) item.voters.splice(idx, 1);
  else item.voters.push(member.peerId);
  broadcastQueue(hub);
  if (socketConnected) {
    socketSend({ t: 'queue:vote', room, peerId: member.peerId, id: msg.id });
  }
}

function extractVideoId(url: string): string | null {
  return parseYouTubeId(url);
}

function socketSend(message: WireMessage): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function applyServerMessage(raw: string): void {
  let msg: WireMessage;
  try {
    msg = JSON.parse(raw) as WireMessage;
  } catch {
    return;
  }
  switch (msg.t) {
    case 'state': {
      const hub = getHub(msg.room);
      hub.queue = sortedQueue(msg.queue ?? []);
      hub.chat = (msg.chat ?? []).slice(-CHAT_CAP);
      hub.media = msg.media ?? null;
      for (const tabId of hub.peers.keys()) {
        const member = hub.peers.get(tabId);
        void sendToTab(tabId, {
          type: 'vibeparty:joined',
          state: {
            room: msg.room,
            peers: msg.peers ?? presenceOf(hub),
            queue: hub.queue,
            chat: hub.chat,
            media: hub.media,
          } satisfies RoomState,
          selfId: member?.peerId ?? '',
        });
      }
      break;
    }
    case 'media-broadcast': {
      const hub = rooms.get(msg.room);
      if (!hub) return;
      hub.media = {
        playing: msg.playing,
        mediaTime: msg.mediaTime,
        serverTime: msg.serverTime,
        videoId: msg.videoId,
        controllerPeerId: msg.from,
      };
      broadcastMedia(hub, undefined, msg.from);
      break;
    }
    case 'chat-broadcast': {
      const hub = rooms.get(msg.room);
      if (!hub) return;
      hub.chat.push(msg.message);
      if (hub.chat.length > CHAT_CAP) hub.chat = hub.chat.slice(-CHAT_CAP);
      broadcastRoom(hub, { type: 'vibeparty:chat', message: msg.message });
      break;
    }
    case 'reaction-broadcast': {
      const hub = rooms.get(msg.room);
      if (!hub) return;
      for (const [tabId, member] of hub.peers) {
        if (member.peerId === msg.reaction.peerId) continue;
        void sendToTab(tabId, { type: 'vibeparty:reaction', reaction: msg.reaction });
      }
      break;
    }
    case 'queue-broadcast': {
      const hub = rooms.get(msg.room);
      if (!hub) return;
      hub.queue = sortedQueue(msg.items ?? []);
      broadcastRoom(hub, { type: 'vibeparty:queue', items: hub.queue });
      break;
    }
    case 'presence-broadcast': {
      const hub = rooms.get(msg.room);
      if (!hub) return;
      broadcastRoom(hub, { type: 'vibeparty:presence', peers: msg.peers ?? [] });
      break;
    }
    case 'pong':
      break;
    default:
      break;
  }
}

function connectSocket(): void {
  if (!socketUrl) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  try {
    socket = new WebSocket(socketUrl);
  } catch {
    scheduleReconnect();
    return;
  }
  socket.addEventListener('open', () => {
    socketConnected = true;
    reconnectAttempts = 0;
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(() => socketSend({ t: 'ping' }), HEARTBEAT_MS);
    }
    for (const [room, hub] of rooms) {
      for (const member of hub.peers.values()) {
        socketSend({ t: 'join', room, peerId: member.peerId, name: member.name });
      }
    }
    notifyStatus();
  });
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') applyServerMessage(event.data);
  });
  socket.addEventListener('close', () => {
    socketConnected = false;
    socket = null;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    notifyStatus();
    scheduleReconnect();
  });
  socket.addEventListener('error', () => {
    socket?.close();
  });
}

function scheduleReconnect(): void {
  if (!socketUrl || reconnectTimer) return;
  reconnectAttempts += 1;
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1));
  const jitter = Math.random() * 400;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectSocket();
  }, delay + jitter);
}

function notifyStatus(): void {
  for (const [room, hub] of rooms) {
    for (const tabId of hub.peers.keys()) {
      void sendToTab(tabId, {
        type: 'vibeparty:status',
        connected: socketConnected,
        room,
      });
    }
  }
}

function getAppStatus(): AppStatus {
  const list: AppStatus['rooms'] = [];
  for (const [room, hub] of rooms) {
    list.push({
      room,
      peers: presenceOf(hub).length,
      queue: hub.queue.length,
      playing: hub.media?.playing ?? false,
    });
  }
  list.sort((a, b) => b.peers - a.peers);
  return { connected: socketConnected, wsConfigured: Boolean(socketUrl), rooms: list };
}

export function initVibePartyBackground(): void {
  socketUrl = String(import.meta.env.WXT_VIBEPARTY_WS_URL ?? '').trim();
  connectSocket();

  browser.runtime.onMessage.addListener(
    (message: ContentToBackground | { type?: string }, sender, sendResponse) => {
      if (!message || typeof message.type !== 'string' || !message.type.startsWith('vibeparty:')) {
        return;
      }
      if (message.type === 'vibeparty:app-status') {
        sendResponse(getAppStatus());
        return;
      }
      const tabId = sender.tab?.id;
      if (typeof tabId !== 'number') return;
      const contentMsg = message as ContentToBackground;
      switch (contentMsg.type) {
        case 'vibeparty:join':
          joinRoom(tabId, contentMsg.room, contentMsg.name);
          break;
        case 'vibeparty:leave':
          leaveRoom(tabId);
          break;
        case 'vibeparty:ping': {
          const found = roomOfTab(tabId);
          if (!found) {
            joinRoom(tabId, contentMsg.room, contentMsg.name);
          }
          break;
        }
        case 'vibeparty:media':
          handleMediaOp(tabId, contentMsg);
          break;
        case 'vibeparty:chat':
          handleChatOp(tabId, contentMsg);
          break;
        case 'vibeparty:reaction':
          handleReactionOp(tabId, contentMsg);
          break;
        case 'vibeparty:queue:add':
          handleQueueAdd(tabId, contentMsg);
          break;
        case 'vibeparty:queue:vote':
          handleQueueVote(tabId, contentMsg);
          break;
        default:
          break;
      }
    },
  );

  browser.tabs.onRemoved.addListener((tabId) => {
    leaveRoom(tabId);
  });
}
