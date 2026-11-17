/**
 * Invites. A party is joined with its room code; an invite is just a way of carrying that code:
 *
 *   • the code on its own            amber-lofi-k7q2x9dm
 *   • a YouTube link that carries it https://www.youtube.com/watch?v=dQw4w9WgXcQ&pact=amber-lofi-k7q2x9dm
 *   • invite text with both          "🍿 Join my VibeParty — room code: amber-lofi-k7q2x9dm" + the link
 *
 * The link works for everyone: with pact installed the YouTube page offers "Join party" (it never joins by itself —
 * a link is untrusted input); without pact it simply opens the video.
 *
 * The code is the room's password, so the content script removes the `pact` parameter from the address bar as soon as it
 * has read it (see `withoutInvite`) — it doesn't linger in history entries, bookmarks or a later shared URL.
 *
 * Pure: no DOM, no browser APIs.
 */
import { findRoomCode, isValidRoomCode, normalizeRoomCode } from '../roomCode.ts';
import { parseYouTubeId } from './protocol.ts';
import { cleanRoom } from './sanitize.ts';

export const INVITE_PARAM = 'pact';

/** `https://www.youtube.com/watch?v=<id>&pact=<room>` (or the YouTube home page when no video is known). */
export function inviteLink(room: string, videoId: string | null): string {
  const url = new URL(videoId ? 'https://www.youtube.com/watch' : 'https://www.youtube.com/');
  if (videoId) url.searchParams.set('v', videoId);
  url.searchParams.set(INVITE_PARAM, room);
  return url.toString();
}

/** What gets copied by "Copy invite": a friendly line (also recognised by pact's chat) plus the link. */
export function inviteText(room: string, videoId: string | null): string {
  return `🍿 Join my VibeParty — room code: ${room}\n${inviteLink(room, videoId)}`;
}

/** The room code a YouTube URL carries (`?pact=` or `#pact=`), or null. Only youtube.com addresses count. */
export function readInviteCode(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!/^(?:www\.|m\.)?youtube\.com$/.test(url.hostname)) return null;
    const fromQuery = url.searchParams.get(INVITE_PARAM);
    const fromHash = new URLSearchParams(url.hash.replace(/^#/, '')).get(INVITE_PARAM);
    return cleanRoom(fromQuery ?? fromHash ?? '');
  } catch {
    return null;
  }
}

/** The same address without the invite parameter (for `history.replaceState`). Unchanged if it has none. */
export function withoutInvite(href: string): string {
  try {
    const url = new URL(href);
    url.searchParams.delete(INVITE_PARAM);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    if (hash.has(INVITE_PARAM)) {
      hash.delete(INVITE_PARAM);
      const rest = hash.toString();
      url.hash = rest ? `#${rest}` : '';
    }
    return url.toString();
  } catch {
    return href;
  }
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/gi;

/**
 * Find a room code in whatever a person pasted: a bare code, an invite link, or the invite text. Returns null when
 * there is nothing that looks like a code (so a half-typed code isn't "corrected" into something else).
 */
export function extractRoomCode(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  for (const link of text.match(URL_IN_TEXT) ?? []) {
    const code = readInviteCode(link);
    if (code) return code;
  }
  const phrased = findRoomCode(text);
  if (phrased) return phrased;
  // A bare code is one token made only of code characters — never a mangled URL or a sentence squashed into dashes.
  if (!/^[a-z0-9-]+$/i.test(text)) return null;
  const bare = normalizeRoomCode(text);
  return isValidRoomCode(bare) ? bare : null;
}

/** The video a pasted link points at (so "Join" can open the right page), if any. */
export function videoOfInvite(input: string): string | null {
  for (const link of input.match(URL_IN_TEXT) ?? []) {
    const id = parseYouTubeId(link);
    if (id) return id;
  }
  return null;
}

/**
 * For a field a person types or pastes a code into: everything `extractRoomCode` understands, plus loosely typed codes
 * ("Friday Vibes" → friday-vibes, as the code field has always done). Anything that looks like an address but carries no
 * code is refused rather than squashed into a junk room name.
 */
export function lenientRoomCode(input: string): string | null {
  const exact = extractRoomCode(input);
  if (exact) return exact;
  const text = input.trim();
  if (!text || /[:/?=&.#@]/.test(text)) return null;
  const loose = normalizeRoomCode(text);
  return isValidRoomCode(loose) ? loose : null;
}
