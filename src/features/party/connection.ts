/**
 * Turns what the party host reports into the words pact's VibeParty page shows — kept out of the component so every state
 * (and the honesty of each label) is testable. A label claims "Live" only when a room's channel really is up.
 */
import type { AppRoomStatus, AppStatus, ConnectionMode, LinkReason } from './vibeparty/protocol';

export type ConnectionSummary = {
  tone: 'neutral' | 'success' | 'warning' | 'destructive';
  label: string;
  hint: string;
  /** Show the "alive" ping on the dot (live, or working on it). */
  pulse: boolean;
  /** Something the person can retry (a room is in an error state or waiting out a backoff). */
  retryable: boolean;
};

/** Which room's state to report when several are open: the one that needs attention most. */
const URGENCY: Record<ConnectionMode, number> = { error: 5, reconnecting: 4, connecting: 3, local: 2, live: 1 };

const LOCAL_HINT: Record<LinkReason, string> = {
  unconfigured: 'This build of pact has no account service, so a party stays inside this browser.',
  'signed-out': 'You’re not signed in to pact, so only YouTube tabs in this browser are in the party. Sign in to invite friends elsewhere.',
  denied: 'The server refused the connection, so the party is only in this browser for now.',
  failed: 'The party can’t reach its server, so it is only in this browser for now.',
};

export function worstRoom(rooms: AppRoomStatus[]): AppRoomStatus | null {
  return [...rooms].sort((a, b) => URGENCY[b.mode] - URGENCY[a.mode])[0] ?? null;
}

/** `configured`: this build has a Supabase project (the page knows; the host only knows once it runs). */
export function summarise(status: AppStatus, configured: boolean): ConnectionSummary {
  const room = worstRoom(status.rooms);
  if (room) {
    const watching = status.rooms.reduce((n, r) => n + r.peers, 0);
    switch (room.mode) {
      case 'live':
        return {
          tone: 'success',
          label: watching > 0 ? `Live · ${watching} watching` : 'Live',
          hint: 'Connected — friends can join from anywhere with the room code.',
          pulse: true,
          retryable: false,
        };
      case 'connecting':
        return { tone: 'neutral', label: 'Connecting…', hint: 'Opening the room’s connection.', pulse: true, retryable: false };
      case 'reconnecting':
        return {
          tone: 'warning',
          label: 'Reconnecting…',
          hint: 'The connection dropped. Changes stay on this browser until it’s back; pact keeps retrying.',
          pulse: true,
          retryable: true,
        };
      case 'error':
        return { tone: 'destructive', label: 'Offline', hint: room.message ?? LOCAL_HINT[room.reason ?? 'failed'], pulse: false, retryable: true };
      default:
        return {
          tone: 'neutral',
          label: 'This browser only',
          hint: LOCAL_HINT[room.reason ?? (configured ? 'signed-out' : 'unconfigured')],
          pulse: false,
          retryable: false,
        };
    }
  }
  if (!configured) return { tone: 'neutral', label: 'This browser only', hint: LOCAL_HINT.unconfigured, pulse: false, retryable: false };
  if (status.hostRunning && !status.online) {
    return { tone: 'neutral', label: 'This browser only', hint: LOCAL_HINT[status.reason ?? 'signed-out'], pulse: false, retryable: false };
  }
  return { tone: 'neutral', label: 'Ready', hint: 'Start a party and friends anywhere can join with the room code.', pulse: false, retryable: false };
}
