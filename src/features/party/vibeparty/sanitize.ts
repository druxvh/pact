/**
 * Everything that crosses a trust boundary is validated here before it touches state:
 *   • content-script messages (a compromised/odd page context, or a bug),
 *   • relay messages (other people's clients — assume hostile),
 *   • and, on the server, every client message.
 *
 * The contract is "never throw, return null / a cleaned value". Callers drop what comes back null.
 * Pure + dependency-light so the relay server can import it directly.
 */
import { isValidRoomCode, normalizeRoomCode } from '../roomCode.ts';
import {
  type AppToBackground,
  type ChatMessage,
  type ClientMessage,
  type ContentToBackground,
  LIMITS,
  type MediaEventName,
  type MediaSnapshot,
  type PeerInfo,
  type QueueItem,
  type ReactionEvent,
  type ServerMessage,
  parseYouTubeId,
  watchUrlFor,
} from './protocol.ts';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// Control characters, zero-width characters and bidi overrides (the last kind lets a name render as something
// it is not). Built from code points rather than a regex literal so no invisible character lives in this file.
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f], // C0 controls (newline and tab included — they collapse to spaces later)
  [0x7f, 0x9f], // DEL + C1 controls
  [0x200b, 0x200f], // zero-width space/joiners, LRM/RLM
  [0x2028, 0x2029], // line / paragraph separators
  [0x202a, 0x202e], // bidi embeddings and overrides
  [0x2060, 0x2069], // word joiner, invisible operators, bidi isolates
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
];
const INVISIBLE = new RegExp(
  `[${INVISIBLE_RANGES.map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join('')}]`,
  'g',
);

/** Truncate by code point so we never cut an emoji (surrogate pair) in half. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return Array.from(s).slice(0, max).join('');
}

export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return truncate(v.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim(), max);
}

export function cleanName(v: unknown): string {
  return cleanText(v, LIMITS.name) || 'guest';
}

export function cleanRoom(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const code = normalizeRoomCode(v);
  return isValidRoomCode(code) ? code : null;
}

export function cleanId(v: unknown): string | null {
  return typeof v === 'string' && /^[\w-]{1,64}$/.test(v) ? v : null;
}

export function cleanVideoId(v: unknown): string | null {
  return typeof v === 'string' && /^[\w-]{11}$/.test(v) ? v : null;
}

const VS16 = String.fromCodePoint(0xfe0f); // emoji presentation selector
const ZWJ = String.fromCodePoint(0x200d); // zero-width joiner (family / profession emoji)
const EMOJI = new RegExp(`^(?:\\p{Extended_Pictographic}(?:${VS16}|${ZWJ}|\\p{Emoji_Modifier})*)+$`, 'u');
export function cleanEmoji(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 && s.length <= LIMITS.emoji && EMOJI.test(s) ? s : null;
}

const MAX_MEDIA_SECONDS = 60 * 60 * 48;
export function cleanMediaTime(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_MEDIA_SECONDS ? v : null;
}

export function cleanMediaEvent(v: unknown): MediaEventName | null {
  return v === 'play' || v === 'pause' || v === 'seek' || v === 'ended' ? v : null;
}

const cleanTimestamp = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

// ── data shapes ──────────────────────────────────────────────────────────────

export function cleanPeers(v: unknown): PeerInfo[] {
  if (!Array.isArray(v)) return [];
  const out: PeerInfo[] = [];
  const seen = new Set<string>();
  for (const p of v) {
    if (!isObj(p)) continue;
    const id = cleanId(p.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: cleanName(p.name) });
    if (out.length >= LIMITS.peersPerRoom) break;
  }
  return out;
}

export function cleanQueueItem(v: unknown): QueueItem | null {
  if (!isObj(v)) return null;
  const id = cleanId(v.id);
  const videoId = cleanVideoId(v.videoId);
  const addedBy = cleanId(v.addedBy);
  const createdAt = cleanTimestamp(v.createdAt);
  if (!id || !videoId || !addedBy || createdAt === null) return null;
  const voters = Array.isArray(v.voters)
    ? [...new Set(v.voters.map(cleanId).filter((x): x is string => x !== null))].slice(0, LIMITS.votersPerItem)
    : [];
  return {
    id,
    videoId,
    url: watchUrlFor(videoId), // never trust a URL from the wire
    title: cleanText(v.title, LIMITS.title) || videoId,
    addedBy,
    addedByName: cleanName(v.addedByName),
    voters,
    createdAt,
  };
}

export function cleanQueue(v: unknown): QueueItem[] {
  if (!Array.isArray(v)) return [];
  const out: QueueItem[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const item = cleanQueueItem(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= LIMITS.queue) break;
  }
  return out;
}

export function cleanChatMessage(v: unknown): ChatMessage | null {
  if (!isObj(v)) return null;
  const id = cleanId(v.id);
  const peerId = cleanId(v.peerId);
  const at = cleanTimestamp(v.at);
  const text = cleanText(v.text, LIMITS.chat);
  if (!id || !peerId || at === null || !text) return null;
  return { id, peerId, name: cleanName(v.name), text, at };
}

export function cleanChat(v: unknown): ChatMessage[] {
  if (!Array.isArray(v)) return [];
  return v
    .map(cleanChatMessage)
    .filter((m): m is ChatMessage => m !== null)
    .slice(-LIMITS.chatHistory);
}

export function cleanReaction(v: unknown): ReactionEvent | null {
  if (!isObj(v)) return null;
  const id = cleanId(v.id);
  const peerId = cleanId(v.peerId);
  const emoji = cleanEmoji(v.emoji);
  const at = cleanTimestamp(v.at);
  if (!id || !peerId || !emoji || at === null) return null;
  return { id, peerId, name: cleanName(v.name), emoji, messageId: cleanId(v.messageId), at };
}

export function cleanSnapshot(v: unknown): MediaSnapshot | null {
  if (!isObj(v)) return null;
  const mediaTime = cleanMediaTime(v.mediaTime);
  if (mediaTime === null || typeof v.playing !== 'boolean') return null;
  const snap: MediaSnapshot = {
    playing: v.playing,
    mediaTime,
    videoId: cleanVideoId(v.videoId),
    controllerPeerId: cleanId(v.controllerPeerId),
  };
  if (v.reason === 'advance') snap.reason = 'advance';
  return snap;
}

// ── message parsers ──────────────────────────────────────────────────────────

/** Messages from a YouTube tab's content script → background. */
export function parseContentMessage(raw: unknown): ContentToBackground | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'vibeparty:hello':
    case 'vibeparty:leave':
    case 'vibeparty:resync':
      return { type: raw.type };
    case 'vibeparty:join':
    case 'vibeparty:ping': {
      const room = cleanRoom(raw.room);
      return room ? { type: raw.type, room, name: cleanName(raw.name) } : null;
    }
    case 'vibeparty:media': {
      const ev = cleanMediaEvent(raw.ev);
      const mediaTime = cleanMediaTime(raw.mediaTime);
      if (!ev || mediaTime === null || typeof raw.playing !== 'boolean') return null;
      return { type: raw.type, ev, mediaTime, playing: raw.playing, videoId: cleanVideoId(raw.videoId) };
    }
    case 'vibeparty:chat': {
      const text = cleanText(raw.text, LIMITS.chat);
      return text ? { type: raw.type, text } : null;
    }
    case 'vibeparty:reaction': {
      const emoji = cleanEmoji(raw.emoji);
      return emoji ? { type: raw.type, emoji, messageId: cleanId(raw.messageId) } : null;
    }
    case 'vibeparty:queue:add': {
      const videoId = typeof raw.url === 'string' ? parseYouTubeId(raw.url) : null;
      return videoId
        ? { type: raw.type, url: watchUrlFor(videoId), title: cleanText(raw.title, LIMITS.title) || videoId }
        : null;
    }
    case 'vibeparty:queue:vote':
    case 'vibeparty:queue:remove': {
      const id = cleanId(raw.id);
      return id ? { type: raw.type, id } : null;
    }
    default:
      return null;
  }
}

/** Messages from the pact page → background. */
export function parseAppMessage(raw: unknown): AppToBackground | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null;
  if (raw.type === 'vibeparty:app-status') return { type: raw.type };
  if (raw.type === 'vibeparty:open') {
    const room = cleanRoom(raw.room);
    return room ? { type: raw.type, room, name: cleanName(raw.name) } : null;
  }
  return null;
}

/** Messages from a client → relay. Run by the server on every frame. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  if (raw.t === 'ping') {
    const ts = cleanTimestamp(raw.ts);
    return ts === null ? null : { t: 'ping', ts };
  }
  const room = cleanRoom(raw.room);
  const peerId = cleanId(raw.peerId);
  if (!room || !peerId) return null;
  switch (raw.t) {
    case 'join':
      return { t: 'join', room, peerId, name: cleanName(raw.name) };
    case 'leave':
      return { t: 'leave', room, peerId };
    case 'media': {
      const ev = cleanMediaEvent(raw.ev);
      const mediaTime = cleanMediaTime(raw.mediaTime);
      if (!ev || mediaTime === null || typeof raw.playing !== 'boolean') return null;
      return { t: 'media', room, peerId, ev, mediaTime, playing: raw.playing, videoId: cleanVideoId(raw.videoId) };
    }
    case 'chat': {
      const id = cleanId(raw.id);
      const text = cleanText(raw.text, LIMITS.chat);
      const at = cleanTimestamp(raw.at);
      return id && text && at !== null ? { t: 'chat', room, peerId, id, text, at } : null;
    }
    case 'reaction': {
      const id = cleanId(raw.id);
      const emoji = cleanEmoji(raw.emoji);
      return id && emoji ? { t: 'reaction', room, peerId, id, emoji, messageId: cleanId(raw.messageId) } : null;
    }
    case 'queue:add': {
      const id = cleanId(raw.id);
      const videoId = typeof raw.url === 'string' ? parseYouTubeId(raw.url) : null;
      return id && videoId
        ? { t: 'queue:add', room, peerId, id, url: watchUrlFor(videoId), title: cleanText(raw.title, LIMITS.title) || videoId }
        : null;
    }
    case 'queue:vote':
    case 'queue:remove': {
      const id = cleanId(raw.id);
      return id ? { t: raw.t, room, peerId, id } : null;
    }
    default:
      return null;
  }
}

/** Messages from the relay → background. Treat the relay (and the people behind it) as untrusted. */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'pong': {
      const ts = cleanTimestamp(raw.ts);
      return ts === null ? null : { t: 'pong', ts };
    }
    case 'error':
      return { t: 'error', code: cleanText(raw.code, 40) || 'error', message: cleanText(raw.message, 200) || 'Something went wrong.' };
    default:
      break;
  }
  const room = cleanRoom(raw.room);
  if (!room) return null;
  switch (raw.t) {
    case 'state':
      return {
        t: 'state',
        room,
        peers: cleanPeers(raw.peers),
        queue: cleanQueue(raw.queue),
        chat: cleanChat(raw.chat),
        media: cleanSnapshot(raw.media),
      };
    case 'media': {
      const media = cleanSnapshot(raw.media);
      return media ? { t: 'media', room, from: cleanId(raw.from), media } : null;
    }
    case 'chat': {
      const message = cleanChatMessage(raw.message);
      return message ? { t: 'chat', room, message } : null;
    }
    case 'reaction': {
      const reaction = cleanReaction(raw.reaction);
      return reaction ? { t: 'reaction', room, reaction } : null;
    }
    case 'queue':
      return { t: 'queue', room, items: cleanQueue(raw.items) };
    case 'presence':
      return { t: 'presence', room, peers: cleanPeers(raw.peers) };
    default:
      return null;
  }
}

/**
 * `WXT_VIBEPARTY_WS_URL` must be `wss://…` — or plain `ws://` only for a relay on this machine.
 * Anything else is ignored (an unencrypted relay would leak every room code and chat message).
 */
export function parseRelayUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol === 'wss:' || (url.protocol === 'ws:' && local)) return url.toString();
  } catch {
    // fall through
  }
  return null;
}
