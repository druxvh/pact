export type PeerInfo = {
  id: string;
  name: string;
};

export type QueueItem = {
  id: string;
  url: string;
  videoId: string | null;
  title: string;
  addedBy: string;
  addedByName: string;
  voters: string[];
  createdAt: number;
};

export type ChatMessage = {
  id: string;
  peerId: string;
  name: string;
  text: string;
  at: number;
};

export type ReactionEvent = {
  id: string;
  peerId: string;
  name: string;
  emoji: string;
  messageId: string | null;
  at: number;
};

export type MediaSnapshot = {
  playing: boolean;
  mediaTime: number;
  serverTime: number;
  videoId: string | null;
  controllerPeerId: string | null;
};

export type RoomState = {
  room: string;
  peers: PeerInfo[];
  queue: QueueItem[];
  chat: ChatMessage[];
  media: MediaSnapshot | null;
};

export type ContentToBackground =
  | { type: 'vibeparty:join'; room: string; name: string }
  | { type: 'vibeparty:leave' }
  | {
      type: 'vibeparty:media';
      ev: 'play' | 'pause' | 'seek' | 'ended' | 'state';
      mediaTime: number;
      playing: boolean;
      videoId: string | null;
    }
  | { type: 'vibeparty:chat'; text: string }
  | { type: 'vibeparty:reaction'; emoji: string; messageId: string | null }
  | { type: 'vibeparty:queue:add'; url: string; title: string }
  | { type: 'vibeparty:queue:vote'; id: string }
  | { type: 'vibeparty:ping'; room: string; name: string };

export type AppToBackground = { type: 'vibeparty:app-status' };

export type AppRoomStatus = {
  room: string;
  peers: number;
  queue: number;
  playing: boolean;
};

export type AppStatus = {
  connected: boolean;
  wsConfigured: boolean;
  rooms: AppRoomStatus[];
};

export const VIBEPARTY_PENDING_KEY = 'vibeparty:pending';

export type PendingRoom = {
  room: string;
  name: string;
  at: number;
};

export type BackgroundToContent =
  | { type: 'vibeparty:joined'; state: RoomState; selfId: string }
  | { type: 'vibeparty:left' }
  | {
      type: 'vibeparty:media';
      from: string;
      playing: boolean;
      mediaTime: number;
      serverTime: number;
      videoId: string | null;
    }
  | { type: 'vibeparty:chat'; message: ChatMessage }
  | { type: 'vibeparty:reaction'; reaction: ReactionEvent }
  | { type: 'vibeparty:queue'; items: QueueItem[] }
  | { type: 'vibeparty:presence'; peers: PeerInfo[] }
  | { type: 'vibeparty:status'; connected: boolean; room: string | null }
  | { type: 'vibeparty:error'; message: string };

export type WireMessage =
  | { t: 'join'; room: string; peerId: string; name: string }
  | { t: 'leave'; room: string; peerId: string }
  | {
      t: 'media';
      room: string;
      peerId: string;
      ev: 'play' | 'pause' | 'seek' | 'ended' | 'state';
      mediaTime: number;
      videoId: string | null;
    }
  | { t: 'chat'; room: string; peerId: string; name: string; text: string; id: string; at: number }
  | { t: 'reaction'; room: string; peerId: string; name: string; emoji: string; messageId: string | null; id: string; at: number }
  | { t: 'queue:add'; room: string; peerId: string; item: QueueItem }
  | { t: 'queue:vote'; room: string; peerId: string; id: string }
  | { t: 'ping' }
  | { t: 'pong' }
  | { t: 'state'; room: string; peers: PeerInfo[]; queue: QueueItem[]; chat: ChatMessage[]; media: MediaSnapshot | null }
  | { t: 'media-broadcast'; room: string; from: string; playing: boolean; mediaTime: number; serverTime: number; videoId: string | null }
  | { t: 'chat-broadcast'; room: string; message: ChatMessage }
  | { t: 'reaction-broadcast'; room: string; reaction: ReactionEvent }
  | { t: 'queue-broadcast'; room: string; items: QueueItem[] }
  | { t: 'presence-broadcast'; room: string; peers: PeerInfo[] };

export function parseYouTubeId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/^[\w-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && /^[\w-]{6,}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const v = url.searchParams.get('v');
      if (v && /^[\w-]{6,}$/.test(v)) return v;
      const m = url.pathname.match(/^\/(shorts|live|embed|v)\/([\w-]{6,})/);
      if (m?.[2]) return m[2];
    }
  } catch {
    return null;
  }
  return null;
}

export function watchUrlFor(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
