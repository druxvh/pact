/**
 * VibeParty protocol (v2).
 *
 * Two hops, each with its own message union:
 *
 *   content script ⇄ background   ContentToBackground / BackgroundToContent   (extension messaging)
 *   background     ⇄ relay        ClientMessage / ServerMessage                (one WebSocket per browser)
 *
 * Clock rule — the old design broke this and drifted: `mediaTime` always means "as of the moment this
 * message was created" (the sender extrapolates first). No timestamp ever crosses a hop for sync purposes;
 * a receiver anchors the snapshot to ITS OWN clock (minus the estimated one-way latency), so two machines
 * with different system clocks still agree on where the video is.
 *
 * This module is imported by the extension AND by the reference relay server (server/relay.ts, run directly
 * by Node/Bun), so it must stay dependency-free and use explicit `.ts` import specifiers.
 */

export const PROTOCOL_VERSION = 2;

export const LIMITS = {
  name: 24,
  chat: 500,
  title: 120,
  emoji: 16,
  queue: 100,
  chatHistory: 200,
  peersPerRoom: 50,
  votersPerItem: 50,
  roomCode: 32,
} as const;

// ── shared data shapes ───────────────────────────────────────────────────────

export type PeerInfo = { id: string; name: string };

export type QueueItem = {
  id: string;
  /** Always the canonical watch URL, rebuilt from `videoId` (never trusted from the wire). */
  url: string;
  videoId: string;
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

export type MediaEventName = 'play' | 'pause' | 'seek' | 'ended';

/** Where the room's video is "right now". */
export type MediaSnapshot = {
  playing: boolean;
  mediaTime: number;
  videoId: string | null;
  controllerPeerId: string | null;
  /** 'advance' = the queue moved on to the next video, so followers should navigate there automatically. */
  reason?: 'advance';
};

export type RoomState = {
  room: string;
  peers: PeerInfo[];
  queue: QueueItem[];
  chat: ChatMessage[];
  media: MediaSnapshot | null;
};

/**
 *  local        — no relay configured: a party syncs the YouTube tabs of THIS browser only.
 *  live         — connected to a relay: friends on other computers can join.
 *  reconnecting — a relay is configured but unreachable right now (changes stay local until it's back).
 */
export type ConnectionMode = 'local' | 'live' | 'reconnecting';

// ── content script ⇄ background ──────────────────────────────────────────────

export type ContentToBackground =
  /** A content script just loaded. If its tab is in a party, the background re-sends `joined`. */
  | { type: 'vibeparty:hello' }
  | { type: 'vibeparty:join'; room: string; name: string }
  | { type: 'vibeparty:leave' }
  | { type: 'vibeparty:media'; ev: MediaEventName; mediaTime: number; playing: boolean; videoId: string | null }
  /** "Tell me where the room's video is" — after an ad, or once the player has loaded. */
  | { type: 'vibeparty:resync' }
  | { type: 'vibeparty:chat'; text: string }
  | { type: 'vibeparty:reaction'; emoji: string; messageId: string | null }
  | { type: 'vibeparty:queue:add'; url: string; title: string }
  | { type: 'vibeparty:queue:vote'; id: string }
  | { type: 'vibeparty:queue:remove'; id: string }
  /** Keep-alive; also re-joins if the background lost its state. */
  | { type: 'vibeparty:ping'; room: string; name: string };

export type BackgroundToContent =
  | { type: 'vibeparty:joined'; state: RoomState; selfId: string; mode: ConnectionMode }
  | { type: 'vibeparty:left' }
  | { type: 'vibeparty:media'; from: string | null; media: MediaSnapshot }
  | { type: 'vibeparty:chat'; message: ChatMessage }
  | { type: 'vibeparty:reaction'; reaction: ReactionEvent }
  | { type: 'vibeparty:queue'; items: QueueItem[] }
  | { type: 'vibeparty:presence'; peers: PeerInfo[] }
  | { type: 'vibeparty:status'; mode: ConnectionMode; room: string | null }
  | { type: 'vibeparty:error'; message: string }
  /** Background → tab: "is your content script alive?" (used before deciding to reload a YouTube tab). */
  | { type: 'vibeparty:probe' };

// ── pact page ⇄ background ───────────────────────────────────────────────────

export type AppToBackground = { type: 'vibeparty:app-status' } | { type: 'vibeparty:open'; room: string; name: string };

export type AppRoomStatus = { room: string; peers: number; queue: number; playing: boolean };

export type AppStatus = { mode: ConnectionMode; rooms: AppRoomStatus[] };

export type OpenResult = { ok: true; reusedTab: boolean } | { ok: false; error: string };

// ── background ⇄ relay (WebSocket) ───────────────────────────────────────────

export type ClientMessage =
  | { t: 'join'; room: string; peerId: string; name: string }
  | { t: 'leave'; room: string; peerId: string }
  | { t: 'media'; room: string; peerId: string; ev: MediaEventName; mediaTime: number; playing: boolean; videoId: string | null }
  | { t: 'chat'; room: string; peerId: string; id: string; text: string; at: number }
  | { t: 'reaction'; room: string; peerId: string; id: string; emoji: string; messageId: string | null }
  | { t: 'queue:add'; room: string; peerId: string; id: string; url: string; title: string }
  | { t: 'queue:vote'; room: string; peerId: string; id: string }
  | { t: 'queue:remove'; room: string; peerId: string; id: string }
  | { t: 'ping'; ts: number };

export type ServerMessage =
  | { t: 'state'; room: string; peers: PeerInfo[]; queue: QueueItem[]; chat: ChatMessage[]; media: MediaSnapshot | null }
  | { t: 'media'; room: string; from: string | null; media: MediaSnapshot }
  | { t: 'chat'; room: string; message: ChatMessage }
  | { t: 'reaction'; room: string; reaction: ReactionEvent }
  | { t: 'queue'; room: string; items: QueueItem[] }
  | { t: 'presence'; room: string; peers: PeerInfo[] }
  | { t: 'pong'; ts: number }
  | { t: 'error'; code: string; message: string };

// ── storage keys (chrome.storage.local) ──────────────────────────────────────

/** Display name shared by the pact page and the YouTube overlay (the overlay can't read pact's localStorage). */
export const VIBEPARTY_NAME_KEY = 'vibeparty:name';
/** Overlay preferences: { collapsed: boolean; autoFollow: boolean }. */
export const VIBEPARTY_PREFS_KEY = 'vibeparty:prefs';

// ── YouTube helpers ──────────────────────────────────────────────────────────

const YT_ID = /^[\w-]{11}$/;

/** Extract an 11-character video id from a YouTube URL (or a bare id). */
export function parseYouTubeId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (YT_ID.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0];
      return id && YT_ID.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const v = url.searchParams.get('v');
      if (v && YT_ID.test(v)) return v;
      const m = /^\/(?:shorts|live|embed|v)\/([\w-]{11})(?:[/?#]|$)/.exec(url.pathname);
      if (m?.[1]) return m[1];
    }
  } catch {
    return null;
  }
  return null;
}

export function watchUrlFor(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function thumbnailUrlFor(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}
