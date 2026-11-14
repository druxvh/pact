/**
 * The brain of the background script, with no browser APIs in it: tabs are plain numbers, messages go out
 * through an injected `send`, and the relay is an injected interface. That makes the whole party lifecycle
 * (join, ghost cleanup, queue, ad-free sync, relay failover) unit-testable — see controller.test.ts.
 *
 * Authority model:
 *   • No relay → this controller IS the room for the tabs of this browser ("local mode").
 *   • Relay connected → the relay is the room. We still apply your own actions immediately (so chat and
 *     playback feel instant) and forward them; everything the relay sends back replaces/merges into our copy.
 *     Whether the queue advances when a video ends is decided by whoever is authoritative, never both.
 */
import { Room, type SerializedRoom } from './room.ts';
import {
  type AppRoomStatus,
  type AppStatus,
  type BackgroundToContent,
  type ChatMessage,
  type ConnectionMode,
  type QueueItem,
  type ReactionEvent,
  type ServerMessage,
  parseYouTubeId,
} from './protocol.ts';
import type { RelayLike } from './relay-client.ts';
import { cleanName, cleanRoom, parseContentMessage } from './sanitize.ts';

type Member = { room: string; peerId: string; name: string; lastSeen: number };
type Pending = { room: string; name: string; at: number };

export type ControllerDeps = {
  now: () => number;
  uuid: () => string;
  send: (tabId: number, msg: BackgroundToContent) => void;
  relay: RelayLike | null;
  /** Called after any state change worth persisting. */
  onChange?: () => void;
};

export type PersistedController = {
  v: 1;
  rooms: SerializedRoom[];
  members: Array<[number, Member]>;
  pending: Array<[number, Pending]>;
};

/** Content scripts ping every 20 s; a tab silent for this long has navigated away or crashed. */
export const STALE_MEMBER_MS = 70_000;
/** How long a tab we opened for a party may take to load YouTube before we stop expecting it. */
export const PENDING_TTL_MS = 120_000;

export class PartyController {
  private readonly rooms = new Map<string, Room>();
  private readonly members = new Map<number, Member>();
  private readonly pending = new Map<number, Pending>();
  private latencyMs = 0;

  constructor(private readonly deps: ControllerDeps) {}

  get mode(): ConnectionMode {
    const r = this.deps.relay;
    return !r ? 'local' : r.connected ? 'live' : 'reconnecting';
  }

  // ── from YouTube tabs ───────────────────────────────────────────────────────

  handleContent(tabId: number, raw: unknown): void {
    const msg = parseContentMessage(raw);
    if (!msg) return;
    this.prune();
    const member = this.members.get(tabId);
    if (member) member.lastSeen = this.deps.now();

    switch (msg.type) {
      case 'vibeparty:hello':
        this.onHello(tabId);
        return;
      case 'vibeparty:join':
        this.joinTab(tabId, msg.room, msg.name);
        return;
      case 'vibeparty:ping':
        if (!member) this.joinTab(tabId, msg.room, msg.name); // the worker lost its state — heal
        return;
      case 'vibeparty:leave':
        this.leaveTab(tabId);
        return;
      default:
        break;
    }

    if (!member) return; // everything below needs a party
    const room = this.rooms.get(member.room);
    if (!room) return;
    const { peerId } = member;

    switch (msg.type) {
      case 'vibeparty:media': {
        if (msg.ev === 'ended') {
          this.onEnded(tabId, room, member, msg.mediaTime, msg.videoId);
          return;
        }
        const snap = room.applyMedia(peerId, msg.ev, msg.mediaTime, msg.playing, msg.videoId);
        this.broadcast(room.id, { type: 'vibeparty:media', from: peerId, media: snap }, { tabId });
        this.deps.relay?.send({ t: 'media', room: room.id, peerId, ev: msg.ev, mediaTime: msg.mediaTime, playing: msg.playing, videoId: msg.videoId });
        this.changed();
        return;
      }
      case 'vibeparty:resync': {
        const snap = room.snapshot();
        if (snap) this.deps.send(tabId, { type: 'vibeparty:media', from: snap.controllerPeerId, media: snap });
        return;
      }
      case 'vibeparty:chat': {
        const message: ChatMessage = { id: this.deps.uuid(), peerId, name: member.name, text: msg.text, at: this.deps.now() };
        room.addChat(message);
        this.broadcast(room.id, { type: 'vibeparty:chat', message });
        this.deps.relay?.send({ t: 'chat', room: room.id, peerId, id: message.id, text: message.text, at: message.at });
        this.changed();
        return;
      }
      case 'vibeparty:reaction': {
        const reaction: ReactionEvent = { id: this.deps.uuid(), peerId, name: member.name, emoji: msg.emoji, messageId: msg.messageId, at: this.deps.now() };
        this.broadcast(room.id, { type: 'vibeparty:reaction', reaction }, { tabId });
        this.deps.relay?.send({ t: 'reaction', room: room.id, peerId, id: reaction.id, emoji: msg.emoji, messageId: msg.messageId });
        return;
      }
      case 'vibeparty:queue:add': {
        const videoId = parseYouTubeId(msg.url) ?? ''; // parseContentMessage already guaranteed a valid watch URL
        const item: QueueItem = {
          id: this.deps.uuid(),
          url: msg.url,
          videoId,
          title: msg.title,
          addedBy: peerId,
          addedByName: member.name,
          voters: [peerId],
          createdAt: this.deps.now(),
        };
        const result = room.addQueue(item);
        if (result !== 'added') {
          this.deps.send(tabId, {
            type: 'vibeparty:error',
            message: result === 'duplicate' ? 'That video is already in the queue.' : 'The queue is full.',
          });
          return;
        }
        this.broadcastQueue(room);
        this.deps.relay?.send({ t: 'queue:add', room: room.id, peerId, id: item.id, url: item.url, title: item.title });
        this.changed();
        return;
      }
      case 'vibeparty:queue:vote': {
        if (!room.vote(msg.id, peerId)) return;
        this.broadcastQueue(room);
        this.deps.relay?.send({ t: 'queue:vote', room: room.id, peerId, id: msg.id });
        this.changed();
        return;
      }
      case 'vibeparty:queue:remove': {
        if (!room.removeQueue(msg.id, peerId)) return;
        this.broadcastQueue(room);
        this.deps.relay?.send({ t: 'queue:remove', room: room.id, peerId, id: msg.id });
        this.changed();
        return;
      }
      default:
        return;
    }
  }

  private onHello(tabId: number): void {
    const pending = this.pending.get(tabId);
    if (pending) {
      this.pending.delete(tabId);
      if (this.deps.now() - pending.at <= PENDING_TTL_MS) {
        this.joinTab(tabId, pending.room, pending.name);
        return;
      }
    }
    // A full-page navigation (e.g. playing a queued video) reloads the content script; hand it the party back.
    if (this.members.has(tabId)) this.sendJoined(tabId);
  }

  private onEnded(tabId: number, room: Room, member: Member, mediaTime: number, videoId: string | null): void {
    const { peerId } = member;
    if (this.deps.relay?.connected) {
      // Every viewer's player fires `ended` at about the same moment. If the room already moved on from this
      // video, this one is a duplicate: don't regress our copy of the room, and don't bother the relay.
      const current = room.snapshot();
      if (current && current.videoId !== videoId) return;
      // The relay decides whether the queue advances. Record "paused at the end" meanwhile.
      const snap = room.applyMedia(peerId, 'ended', mediaTime, false, videoId);
      this.broadcast(room.id, { type: 'vibeparty:media', from: peerId, media: snap }, { tabId });
      this.deps.relay.send({ t: 'media', room: room.id, peerId, ev: 'ended', mediaTime, playing: false, videoId });
      this.changed();
      return;
    }
    const res = room.onEnded(peerId, videoId, mediaTime);
    if (res.queueChanged) this.broadcastQueue(room);
    if (res.snapshot) {
      // On advance everybody (including the tab whose video just ended) must navigate to the next video.
      this.broadcast(room.id, { type: 'vibeparty:media', from: res.advanced ? null : peerId, media: res.snapshot }, res.advanced ? {} : { tabId });
    }
    this.changed();
  }

  // ── joining & leaving ───────────────────────────────────────────────────────

  /** Put a tab into a party (idempotent: calling it again for the same room just re-sends the state). */
  joinTab(tabId: number, rawRoom: string, rawName: string): boolean {
    const roomId = cleanRoom(rawRoom);
    if (!roomId) {
      this.deps.send(tabId, { type: 'vibeparty:error', message: 'That room code isn’t valid.' });
      return false;
    }
    const name = cleanName(rawName);
    const existing = this.members.get(tabId);
    if (existing && existing.room !== roomId) this.leaveTab(tabId, true);

    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId, this.deps.now);
      this.rooms.set(roomId, room);
    }

    let member = this.members.get(tabId);
    if (member) {
      member.name = name;
      member.lastSeen = this.deps.now();
      room.join(member.peerId, name);
    } else {
      const peerId = this.deps.uuid();
      if (room.join(peerId, name) === 'full') {
        if (room.size === 0) this.rooms.delete(roomId);
        this.deps.send(tabId, { type: 'vibeparty:error', message: 'This room is full.' });
        return false;
      }
      member = { room: roomId, peerId, name, lastSeen: this.deps.now() };
      this.members.set(tabId, member);
    }

    this.deps.relay?.send({ t: 'join', room: roomId, peerId: member.peerId, name });
    this.sendJoined(tabId);
    this.broadcast(roomId, { type: 'vibeparty:presence', peers: room.peers() }, { tabId });
    this.changed();
    return true;
  }

  /** A tab we're about to open (or reload) for a party: join it as soon as its content script says hello. */
  expectTab(tabId: number, rawRoom: string, rawName: string): boolean {
    const room = cleanRoom(rawRoom);
    if (!room) return false;
    this.pending.set(tabId, { room, name: cleanName(rawName), at: this.deps.now() });
    this.changed();
    return true;
  }

  leaveTab(tabId: number, silent = false): void {
    const member = this.members.get(tabId);
    if (!member) return;
    this.members.delete(tabId);
    const room = this.rooms.get(member.room);
    room?.leave(member.peerId);
    this.deps.relay?.send({ t: 'leave', room: member.room, peerId: member.peerId });
    if (!silent) this.deps.send(tabId, { type: 'vibeparty:left' });
    if (room) {
      if (this.tabsIn(member.room).length === 0) this.rooms.delete(member.room);
      else this.broadcast(member.room, { type: 'vibeparty:presence', peers: room.peers() });
    }
    this.changed();
  }

  tabClosed(tabId: number): void {
    this.pending.delete(tabId);
    this.leaveTab(tabId, true);
  }

  /** Drop tabs that stopped pinging (navigated away from YouTube, crashed…) so they don't haunt the room. */
  prune(): void {
    const now = this.deps.now();
    for (const [tabId, m] of [...this.members]) {
      if (now - m.lastSeen > STALE_MEMBER_MS) this.leaveTab(tabId, true);
    }
    for (const [tabId, p] of [...this.pending]) {
      if (now - p.at > PENDING_TTL_MS) this.pending.delete(tabId);
    }
  }

  // ── from the relay ──────────────────────────────────────────────────────────

  setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  relayOpened(): void {
    // The relay forgot us when the socket dropped — re-announce every peer.
    for (const m of this.members.values()) this.deps.relay?.send({ t: 'join', room: m.room, peerId: m.peerId, name: m.name });
    this.broadcastStatus();
  }

  relayClosed(): void {
    this.broadcastStatus();
  }

  relayMessage(msg: ServerMessage): void {
    if (msg.t === 'pong') return;
    if (msg.t === 'error') {
      for (const tabId of this.members.keys()) this.deps.send(tabId, { type: 'vibeparty:error', message: msg.message });
      return;
    }
    const room = this.rooms.get(msg.room);
    if (!room) return;

    switch (msg.t) {
      case 'state': {
        room.replace(msg, this.latencyMs);
        for (const tabId of this.tabsIn(room.id)) this.sendJoined(tabId);
        break;
      }
      case 'media': {
        room.adoptSnapshot(msg.media, this.latencyMs);
        const snap = room.snapshot();
        if (snap) {
          const advance = msg.media.reason === 'advance';
          this.broadcast(
            room.id,
            { type: 'vibeparty:media', from: msg.from, media: advance ? { ...snap, reason: 'advance' } : snap },
            advance || !msg.from ? {} : { peerId: msg.from },
          );
        }
        break;
      }
      case 'chat':
        if (room.addChat(msg.message)) this.broadcast(room.id, { type: 'vibeparty:chat', message: msg.message });
        break;
      case 'reaction':
        this.broadcast(room.id, { type: 'vibeparty:reaction', reaction: msg.reaction }, { peerId: msg.reaction.peerId });
        break;
      case 'queue':
        room.setQueue(msg.items);
        this.broadcastQueue(room);
        break;
      case 'presence':
        room.setPeers(msg.peers);
        this.broadcast(room.id, { type: 'vibeparty:presence', peers: room.peers() });
        break;
      default:
        break;
    }
    this.changed();
  }

  // ── status & persistence ────────────────────────────────────────────────────

  appStatus(): AppStatus {
    const rooms: AppRoomStatus[] = [];
    for (const room of this.rooms.values()) {
      if (this.tabsIn(room.id).length === 0) continue;
      rooms.push({ room: room.id, peers: room.size, queue: room.sortedQueue().length, playing: room.snapshot()?.playing ?? false });
    }
    rooms.sort((a, b) => b.peers - a.peers);
    return { mode: this.mode, rooms };
  }

  serialize(): PersistedController {
    return {
      v: 1,
      rooms: [...this.rooms.values()].map((r) => r.toJSON()),
      members: [...this.members].map(([id, m]) => [id, { ...m }]),
      pending: [...this.pending].map(([id, p]) => [id, { ...p }]),
    };
  }

  /** Restore after the MV3 service worker was torn down and restarted. Never throws. */
  restore(data: unknown): void {
    try {
      if (typeof data !== 'object' || data === null || (data as PersistedController).v !== 1) return;
      const d = data as PersistedController;
      for (const raw of d.rooms ?? []) {
        const room = Room.fromJSON(raw, this.deps.now);
        if (room) this.rooms.set(room.id, room);
      }
      for (const [tabId, m] of d.members ?? []) {
        const roomId = cleanRoom(m?.room);
        if (typeof tabId !== 'number' || !roomId || !this.rooms.has(roomId) || typeof m.peerId !== 'string') continue;
        this.members.set(tabId, { room: roomId, peerId: m.peerId, name: cleanName(m.name), lastSeen: Number.isFinite(m.lastSeen) ? m.lastSeen : 0 });
      }
      for (const [tabId, p] of d.pending ?? []) {
        const room = cleanRoom(p?.room);
        if (typeof tabId === 'number' && room) this.pending.set(tabId, { room, name: cleanName(p.name), at: Number.isFinite(p.at) ? p.at : 0 });
      }
      // Rooms nobody is in anymore aren't worth keeping.
      for (const id of [...this.rooms.keys()]) if (this.tabsIn(id).length === 0) this.rooms.delete(id);
      this.prune();
    } catch {
      /* corrupt snapshot: start clean */
    }
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private tabsIn(roomId: string): number[] {
    const ids: number[] = [];
    for (const [tabId, m] of this.members) if (m.room === roomId) ids.push(tabId);
    return ids;
  }

  private sendJoined(tabId: number): void {
    const m = this.members.get(tabId);
    const room = m && this.rooms.get(m.room);
    if (!m || !room) return;
    this.deps.send(tabId, { type: 'vibeparty:joined', selfId: m.peerId, mode: this.mode, state: room.state() });
  }

  private broadcast(roomId: string, msg: BackgroundToContent, except: { tabId?: number; peerId?: string } = {}): void {
    for (const [tabId, m] of this.members) {
      if (m.room !== roomId || tabId === except.tabId) continue;
      if (except.peerId !== undefined && m.peerId === except.peerId) continue;
      this.deps.send(tabId, msg);
    }
  }

  private broadcastQueue(room: Room): void {
    this.broadcast(room.id, { type: 'vibeparty:queue', items: room.sortedQueue() });
  }

  private broadcastStatus(): void {
    for (const [tabId, m] of this.members) this.deps.send(tabId, { type: 'vibeparty:status', mode: this.mode, room: m.room });
  }

  private changed(): void {
    this.deps.onChange?.();
  }
}
