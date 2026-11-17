/**
 * The room's rules as a transport-agnostic hub: it takes one member's message and says who should hear what.
 *
 * There is no server in a Realtime party, so one member per room plays the hub (elected through Presence — see
 * realtime-client.ts). It is exactly what the old standalone relay was, minus the sockets: the same `Room` state machine,
 * the same authority over "who may remove a queue item" and "the queue advances once when a video ends", the same rule that
 * the origin of a chat / playback event is not told about its own event.
 *
 * What it deliberately does NOT own:
 *   • the roster — Presence is authoritative about who is here (`setRoster`), so a hub that is elected late, or replaced,
 *     never has a stale idea of the room's members;
 *   • delivery — it returns `Outgoing` descriptors; the transport decides how they travel.
 *
 * Everything a member sends is untrusted (it was already sanitised by `parseClientMessage`, but a member can still lie
 * about being someone else): a message naming a peer that belongs to a *different* client is dropped.
 */

import type { ClientMessage } from './protocol.ts';
import {
  type ChatMessage,
  type MediaSnapshot,
  type PeerInfo,
  parseYouTubeId,
  type QueueItem,
  type ReactionEvent,
  type RoomState,
  type ServerMessage,
  WIRE,
} from './protocol.ts';
import { Room } from './room.ts';
import { cleanName, jsonBytes } from './sanitize.ts';

/** One message the hub wants delivered: to a single client (`to`), or to everyone except one client (`except`). */
export type Outgoing = { msg: ServerMessage; to?: string; except?: string };

export type RosterEntry = { clientId: string; peers: PeerInfo[] };

export class RoomHub {
  readonly room: Room;
  /** peer id → the client (browser) that announced it in Presence. */
  private readonly owners = new Map<string, string>();
  /** Names learned from `join` messages, for a peer whose Presence entry hasn't reached us yet. */
  private readonly hints = new Map<string, string>();

  constructor(
    readonly roomId: string,
    private readonly now: () => number = Date.now,
  ) {
    this.room = new Room(roomId, now);
  }

  /** Start from a member's copy of the room (a freshly elected hub keeps the room going instead of resetting it). */
  seed(state: Omit<RoomState, 'room'>, latencyMs = 0): void {
    this.room.replace(state, latencyMs);
  }

  /** Presence says who is here, and which client each peer belongs to. */
  setRoster(entries: RosterEntry[]): void {
    this.owners.clear();
    const peers: PeerInfo[] = [];
    for (const e of entries) {
      for (const p of e.peers) {
        if (this.owners.has(p.id)) continue;
        this.owners.set(p.id, e.clientId);
        peers.push(p);
      }
    }
    this.room.setPeers(peers);
    for (const id of [...this.hints.keys()]) if (this.owners.has(id)) this.hints.delete(id); // Presence knows them now
  }

  private nameOf(peerId: string): string {
    return this.room.hasPeer(peerId) ? this.room.nameOf(peerId) : (this.hints.get(peerId) ?? 'guest');
  }

  /** The room as a joiner needs it. Oldest chat is dropped until it fits the wire budget. */
  state(): Extract<ServerMessage, { t: 'state' }> {
    const base = { t: 'state' as const, room: this.roomId, peers: this.room.peers(), queue: this.room.sortedQueue(), media: this.room.snapshot() };
    let chat = this.room.chat();
    while (chat.length > 0 && jsonBytes({ ...base, chat }) > WIRE.stateBytes) chat = chat.slice(Math.max(1, Math.ceil(chat.length / 8)));
    return { ...base, chat };
  }

  handle(from: string, msg: ClientMessage): Outgoing[] {
    switch (msg.t) {
      case 'ping':
        return [{ to: from, msg: { t: 'pong', ts: msg.ts } }];
      case 'join':
        if (!this.owners.has(msg.peerId)) this.hints.set(msg.peerId, cleanName(msg.name));
        return [{ to: from, msg: this.state() }];
      case 'leave':
        this.hints.delete(msg.peerId);
        return []; // the roster comes from Presence
      default:
        break;
    }

    // Everything else must come from the client that owns this peer (when we know who that is).
    const owner = this.owners.get(msg.peerId);
    if (owner !== undefined && owner !== from) return [];
    const room = this.room;
    const id = room.id;

    switch (msg.t) {
      case 'media': {
        if (msg.ev === 'ended') {
          const res = room.onEnded(msg.peerId, msg.videoId, msg.mediaTime);
          const out: Outgoing[] = [];
          if (res.queueChanged) out.push({ msg: { t: 'queue', room: id, items: room.sortedQueue() } });
          // On advance the origin must navigate too; otherwise it already knows.
          if (res.snapshot)
            out.push({ msg: { t: 'media', room: id, from: res.advanced ? null : msg.peerId, media: res.snapshot }, except: res.advanced ? undefined : from });
          return out;
        }
        const media: MediaSnapshot = room.applyMedia(msg.peerId, msg.ev, msg.mediaTime, msg.playing, msg.videoId);
        return [{ msg: { t: 'media', room: id, from: msg.peerId, media }, except: from }];
      }

      case 'chat': {
        const message: ChatMessage = { id: msg.id, peerId: msg.peerId, name: this.nameOf(msg.peerId), text: msg.text, at: this.now() };
        return room.addChat(message) ? [{ msg: { t: 'chat', room: id, message }, except: from }] : [];
      }

      case 'reaction': {
        const reaction: ReactionEvent = {
          id: msg.id,
          peerId: msg.peerId,
          name: this.nameOf(msg.peerId),
          emoji: msg.emoji,
          messageId: msg.messageId,
          at: this.now(),
        };
        return [{ msg: { t: 'reaction', room: id, reaction }, except: from }];
      }

      case 'queue:add': {
        const item: QueueItem = {
          id: msg.id,
          url: msg.url,
          videoId: parseYouTubeId(msg.url) ?? '', // sanitised already
          title: msg.title,
          addedBy: msg.peerId,
          addedByName: this.nameOf(msg.peerId),
          voters: [msg.peerId],
          createdAt: this.now(),
        };
        // Whether it was added, a duplicate or the queue is full, everyone (origin included) gets the authoritative list.
        room.addQueue(item);
        return [{ msg: { t: 'queue', room: id, items: room.sortedQueue() } }];
      }

      case 'queue:vote':
        return room.vote(msg.id, msg.peerId) ? [{ msg: { t: 'queue', room: id, items: room.sortedQueue() } }] : [];

      case 'queue:remove':
        return room.removeQueue(msg.id, msg.peerId) ? [{ msg: { t: 'queue', room: id, items: room.sortedQueue() } }] : [];

      default:
        return [];
    }
  }
}
