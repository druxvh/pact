/**
 * One VibeParty room as a pure state machine: who's here, the queue, recent chat, and where the video is.
 *
 * The extension's background script runs one `Room` per party for the tabs of THIS browser, and the relay
 * server runs one per party for everyone — the exact same rules in both places is what lets a local party
 * and a live party behave identically. No timers, no I/O: the clock is injected so every rule is testable.
 */
import { type ChatMessage, LIMITS, type MediaEventName, type MediaSnapshot, type PeerInfo, type QueueItem, type RoomState } from './protocol.ts';
import { cleanChat, cleanId, cleanMediaTime, cleanPeers, cleanQueue, cleanVideoId } from './sanitize.ts';

/** `mediaTime` was true at local time `at` (ms). Extrapolated forward while `playing`. */
type Anchor = { playing: boolean; mediaTime: number; at: number; videoId: string | null; controllerPeerId: string | null };

export type SerializedRoom = {
  id: string;
  peers: PeerInfo[];
  queue: QueueItem[];
  chat: ChatMessage[];
  anchor: Anchor | null;
  emptySince: number | null;
};

const MAX_LATENCY_MS = 5_000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export class Room {
  readonly id: string;
  private readonly now: () => number;
  private readonly peerMap = new Map<string, PeerInfo>();
  private queueItems: QueueItem[] = [];
  private chatLog: ChatMessage[] = [];
  private anchor: Anchor | null = null;
  /** When the last peer left (the relay garbage-collects rooms that stay empty). Null while anyone is here. */
  emptySince: number | null;

  constructor(id: string, now: () => number = Date.now) {
    this.id = id;
    this.now = now;
    this.emptySince = now();
  }

  // ── people ────────────────────────────────────────────────────────────────

  /** Add a peer, or rename one who is already here. */
  join(peerId: string, name: string): 'joined' | 'updated' | 'full' {
    const existing = this.peerMap.has(peerId);
    if (!existing && this.peerMap.size >= LIMITS.peersPerRoom) return 'full';
    this.peerMap.set(peerId, { id: peerId, name });
    this.emptySince = null;
    return existing ? 'updated' : 'joined';
  }

  leave(peerId: string): boolean {
    const had = this.peerMap.delete(peerId);
    if (this.anchor?.controllerPeerId === peerId) this.anchor.controllerPeerId = null;
    if (this.peerMap.size === 0) this.emptySince ??= this.now();
    return had;
  }

  /** Replace the whole roster (the relay is authoritative about who's in the room). */
  setPeers(peers: PeerInfo[]): void {
    this.peerMap.clear();
    for (const p of peers.slice(0, LIMITS.peersPerRoom)) this.peerMap.set(p.id, p);
    if (this.peerMap.size > 0) this.emptySince = null;
    else this.emptySince ??= this.now();
  }

  peers(): PeerInfo[] {
    return [...this.peerMap.values()];
  }

  hasPeer(peerId: string): boolean {
    return this.peerMap.has(peerId);
  }

  get size(): number {
    return this.peerMap.size;
  }

  nameOf(peerId: string): string {
    return this.peerMap.get(peerId)?.name ?? 'guest';
  }

  // ── media ─────────────────────────────────────────────────────────────────

  /** Where the video is right now (extrapolated on OUR clock), or null if nobody has played anything yet. */
  snapshot(): MediaSnapshot | null {
    const a = this.anchor;
    if (!a) return null;
    const elapsed = a.playing ? Math.max(0, (this.now() - a.at) / 1000) : 0;
    return { playing: a.playing, mediaTime: a.mediaTime + elapsed, videoId: a.videoId, controllerPeerId: a.controllerPeerId };
  }

  /** A peer in this room did something to the player. Returns the resulting snapshot. */
  applyMedia(peerId: string, ev: MediaEventName, mediaTime: number, playing: boolean, videoId: string | null): MediaSnapshot {
    const nowPlaying = ev === 'play' ? true : ev === 'pause' || ev === 'ended' ? false : playing;
    this.anchor = { playing: nowPlaying, mediaTime, at: this.now(), videoId, controllerPeerId: peerId };
    return this.snapshot() as MediaSnapshot;
  }

  /**
   * Adopt a snapshot that arrived from elsewhere. Its `mediaTime` was true about `latencyMs` ago, so we
   * back-date the anchor on our own clock — never trusting the sender's clock.
   */
  adoptSnapshot(snap: MediaSnapshot, latencyMs = 0): void {
    this.anchor = {
      playing: snap.playing,
      mediaTime: snap.mediaTime,
      at: this.now() - clamp(latencyMs, 0, MAX_LATENCY_MS),
      videoId: snap.videoId,
      controllerPeerId: snap.controllerPeerId,
    };
  }

  /**
   * The room's video reached the end. Every viewer's player fires `ended` at about the same moment, so this
   * is idempotent: the first one advances the queue, the rest find the room already moved on and are ignored.
   */
  onEnded(peerId: string, videoId: string | null, mediaTime: number): { advanced: boolean; queueChanged: boolean; snapshot: MediaSnapshot | null } {
    if (this.anchor && this.anchor.videoId !== videoId) return { advanced: false, queueChanged: false, snapshot: null };

    let queueChanged = false;
    if (videoId) {
      const played = this.sortedQueue().find((q) => q.videoId === videoId);
      if (played) {
        this.queueItems = this.queueItems.filter((q) => q.id !== played.id);
        queueChanged = true;
      }
    }
    const next = this.sortedQueue()[0];
    if (next) {
      this.anchor = { playing: true, mediaTime: 0, at: this.now(), videoId: next.videoId, controllerPeerId: null };
      return { advanced: true, queueChanged, snapshot: { ...(this.snapshot() as MediaSnapshot), reason: 'advance' } };
    }
    this.anchor = { playing: false, mediaTime, at: this.now(), videoId, controllerPeerId: peerId };
    return { advanced: false, queueChanged, snapshot: this.snapshot() };
  }

  // ── chat ──────────────────────────────────────────────────────────────────

  /** False when we already have this message (the relay echoes, and so do optimistic local adds). */
  addChat(message: ChatMessage): boolean {
    if (this.chatLog.some((m) => m.id === message.id)) return false;
    this.chatLog.push(message);
    if (this.chatLog.length > LIMITS.chatHistory) this.chatLog = this.chatLog.slice(-LIMITS.chatHistory);
    return true;
  }

  chat(): ChatMessage[] {
    return [...this.chatLog];
  }

  // ── queue ─────────────────────────────────────────────────────────────────

  addQueue(item: QueueItem): 'added' | 'duplicate' | 'full' {
    if (this.queueItems.some((q) => q.id === item.id || q.videoId === item.videoId)) return 'duplicate';
    if (this.queueItems.length >= LIMITS.queue) return 'full';
    this.queueItems.push(item);
    return 'added';
  }

  /** Toggle `peerId`'s vote. */
  vote(itemId: string, peerId: string): boolean {
    const item = this.queueItems.find((q) => q.id === itemId);
    if (!item) return false;
    const i = item.voters.indexOf(peerId);
    if (i >= 0) item.voters.splice(i, 1);
    else if (item.voters.length < LIMITS.votersPerItem) item.voters.push(peerId);
    return true;
  }

  /** You can remove your own items — or any item whose owner has left the room. */
  removeQueue(itemId: string, peerId: string): boolean {
    const item = this.queueItems.find((q) => q.id === itemId);
    if (!item) return false;
    if (item.addedBy !== peerId && this.peerMap.has(item.addedBy)) return false;
    this.queueItems = this.queueItems.filter((q) => q.id !== itemId);
    return true;
  }

  setQueue(items: QueueItem[]): void {
    this.queueItems = items.slice(0, LIMITS.queue);
  }

  /** Most votes first; ties go to whoever was queued first. */
  sortedQueue(): QueueItem[] {
    return [...this.queueItems].sort((a, b) => b.voters.length - a.voters.length || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  }

  // ── whole-room ────────────────────────────────────────────────────────────

  state(): RoomState {
    return { room: this.id, peers: this.peers(), queue: this.sortedQueue(), chat: this.chat(), media: this.snapshot() };
  }

  /** Replace everything with the relay's version of the room. */
  replace(state: Omit<RoomState, 'room'>, latencyMs = 0): void {
    this.setPeers(state.peers);
    this.queueItems = state.queue.slice(0, LIMITS.queue);
    this.chatLog = state.chat.slice(-LIMITS.chatHistory);
    if (state.media) this.adoptSnapshot(state.media, latencyMs);
    else this.anchor = null;
  }

  toJSON(): SerializedRoom {
    return {
      id: this.id,
      peers: this.peers(),
      queue: this.queueItems.map((q) => ({ ...q, voters: [...q.voters] })),
      chat: this.chat(),
      anchor: this.anchor ? { ...this.anchor } : null,
      emptySince: this.emptySince,
    };
  }

  /** Rebuild a room from `toJSON()` output. Re-validates everything — storage can be stale or tampered with. */
  static fromJSON(data: unknown, now: () => number = Date.now): Room | null {
    if (typeof data !== 'object' || data === null) return null;
    const d = data as Partial<Record<keyof SerializedRoom, unknown>>;
    const id = typeof d.id === 'string' ? d.id : null;
    if (!id) return null;
    const room = new Room(id, now);
    room.setPeers(cleanPeers(d.peers));
    room.queueItems = cleanQueue(d.queue);
    room.chatLog = cleanChat(d.chat);
    const a = d.anchor as Partial<Anchor> | null | undefined;
    const mediaTime = a ? cleanMediaTime(a.mediaTime) : null;
    if (a && mediaTime !== null && typeof a.playing === 'boolean' && typeof a.at === 'number' && Number.isFinite(a.at)) {
      room.anchor = { playing: a.playing, mediaTime, at: a.at, videoId: cleanVideoId(a.videoId), controllerPeerId: cleanId(a.controllerPeerId) };
    }
    room.emptySince = typeof d.emptySince === 'number' ? d.emptySince : room.peerMap.size === 0 ? now() : null;
    return room;
  }
}
