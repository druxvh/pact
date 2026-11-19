/**
 * VibeParty protocol (v3).
 *
 * Three hops, each with its own message union:
 *
 *   content script ⇄ background   ContentToBackground / BackgroundToContent   (extension messaging)
 *   background     ⇄ party host   HostCommand / HostEvent                     (extension messaging; see host.ts)
 *   party host     ⇄ the room     ClientMessage / ServerMessage                (a private Supabase Realtime channel)
 *
 * The room hop is peer-to-peer: one client per room is the *hub* — it runs the room's rules (room.ts) and answers the
 * others — and is elected through Realtime Presence (realtime-client.ts). ClientMessage / ServerMessage are the same
 * vocabulary the old standalone relay spoke, so the controller never knew the difference.
 *
 * Clock rule — the old design broke this and drifted: `mediaTime` always means "as of the moment this
 * message was created" (the sender extrapolates first). No timestamp ever crosses a hop for sync purposes;
 * a receiver anchors the snapshot to ITS OWN clock (minus the estimated one-way latency), so two machines
 * with different system clocks still agree on where the video is.
 *
 * This module is dependency-free and uses explicit `.ts` import specifiers, so it can be imported from any context
 * (service worker, offscreen document, content script, node tests).
 */

export const PROTOCOL_VERSION = 3;

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

/** Wire-level caps. Realtime itself allows far larger payloads; ours are tight so one member can't make everyone parse megabytes. */
export const WIRE = {
  /** Realtime broadcast events: member → hub, and hub → members. */
  clientEvent: 'c',
  serverEvent: 's',
  /** A single client message (media, chat, vote…). */
  clientBytes: 16 * 1024,
  /** A single hub message. Only `state` (chat history + queue) gets anywhere near this. */
  serverBytes: 192 * 1024,
  /** What the hub aims for when it builds a `state` for a joiner (oldest chat is dropped first). */
  stateBytes: 128 * 1024,
  /** Presence payload: a handful of {id, name} pairs. */
  presenceBytes: 8 * 1024,
} as const;

export const topicFor = (room: string) => `party:${room}`;

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
 *  local        — no live link: a party syncs the YouTube tabs of THIS browser only (see `LinkReason`).
 *  connecting   — opening the room's channel for the first time.
 *  live         — connected: friends on other computers who join the same code are in the same room.
 *  reconnecting — the channel dropped; changes stay on this browser until it is back (retried with backoff).
 *  error        — the room can't be reached and retrying won't fix it by itself (see `LinkReason` / `message`).
 */
export type ConnectionMode = 'local' | 'connecting' | 'live' | 'reconnecting' | 'error';

/** Why a party is `local` or in `error`. */
export type LinkReason =
  /** This build has no Supabase project configured. */
  | 'unconfigured'
  /** Not signed in to pact: live parties need an account. */
  | 'signed-out'
  /** The server refused the channel (not signed in properly, or the project's Realtime policies aren't applied). */
  | 'denied'
  /** Something else went wrong and we gave up retrying quickly (the host keeps trying slowly). */
  | 'failed';

export type LinkStatus = { mode: ConnectionMode; reason?: LinkReason; message?: string };

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
  | { type: 'vibeparty:ping'; room: string; name: string }
  /** "Try the connection again now" (the panel's Retry button). */
  | { type: 'vibeparty:retry' }
  /** Open pact's own page (to sign in) — content scripts can't open extension pages themselves. */
  | { type: 'vibeparty:open-pact' };

export type BackgroundToContent =
  | ({ type: 'vibeparty:joined'; state: RoomState; selfId: string } & LinkStatus)
  | { type: 'vibeparty:left' }
  | { type: 'vibeparty:media'; from: string | null; media: MediaSnapshot }
  | { type: 'vibeparty:chat'; message: ChatMessage }
  | { type: 'vibeparty:reaction'; reaction: ReactionEvent }
  | { type: 'vibeparty:queue'; items: QueueItem[] }
  | { type: 'vibeparty:presence'; peers: PeerInfo[] }
  | ({ type: 'vibeparty:status'; room: string | null } & LinkStatus)
  | { type: 'vibeparty:error'; message: string }
  /** Background → tab: "is your content script alive?" (used before deciding to reload a YouTube tab). */
  | { type: 'vibeparty:probe' };

// ── pact page ⇄ background ───────────────────────────────────────────────────

export type AppToBackground = { type: 'vibeparty:app-status' } | { type: 'vibeparty:open'; room: string; name: string } | { type: 'vibeparty:retry' };

export type AppRoomStatus = { room: string; peers: number; queue: number; playing: boolean } & LinkStatus;

export type AppStatus = {
  /** False when no host is running (no party has been started): `online` / `reason` are then unknown — pact's page knows its own sign-in state. */
  hostRunning: boolean;
  /** Nobody is in a party and no tab is on its way to one (the service worker only closes an idle host). */
  idle: boolean;
  /** Can a party reach friends right now (backend configured and signed in)? When false, `reason` says why. */
  online: boolean;
  reason?: LinkReason;
  rooms: AppRoomStatus[];
};

export type OpenResult = { ok: true; reusedTab: boolean } | { ok: false; error: string };

// ── background ⇄ party host ──────────────────────────────────────────────────
// The party host is the long-lived extension page that owns the controller and the Realtime connection (an offscreen
// document in Chromium, the background page itself in Firefox). The service worker only forwards: it has the `tabs` API,
// the host has `localStorage` (where the Supabase session lives) and doesn't get killed when idle.

export type HostCommand =
  | { type: 'vibeparty-host:content'; tabId: number; message: unknown }
  | { type: 'vibeparty-host:tab-closed'; tabId: number }
  | { type: 'vibeparty-host:join-tab'; tabId: number; room: string; name: string }
  | { type: 'vibeparty-host:expect-tab'; tabId: number; room: string; name: string }
  | { type: 'vibeparty-host:status' }
  | { type: 'vibeparty-host:retry' }
  | { type: 'vibeparty-host:ping' };

export type HostEvent =
  | { type: 'vibeparty-host:deliver'; tabId: number; msg: BackgroundToContent }
  /** The host has had nothing to do for a while: the service worker may close it (it comes back when a party starts). */
  | { type: 'vibeparty-host:idle' };

// ── party host ⇄ the room (Realtime broadcast + presence) ────────────────────

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

/** What each member puts in Presence: its local peers (one per YouTube tab) and whether it currently claims the hub role. */
export type PresenceMeta = {
  v: 1 /** Monotonic per client — the newest wins when a reconnect leaves a stale entry behind. */;
  seq: number;
  hub: boolean;
  peers: PeerInfo[];
};

// ── storage keys ─────────────────────────────────────────────────────────────

/** Display name shared by the pact page and the YouTube overlay (the overlay can't read pact's localStorage). chrome.storage.local. */
export const VIBEPARTY_NAME_KEY = 'vibeparty:name';
/** The host's stable identity (localStorage of the extension origin): lets a reconnecting browser reclaim its place in a room. */
export const VIBEPARTY_CLIENT_KEY = 'pact-party-client';
/** The host's persisted controller state (localStorage of the extension origin): tabs keep their peer ids if the host restarts. */
export const VIBEPARTY_HOST_STATE_KEY = 'pact-party-host';
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
