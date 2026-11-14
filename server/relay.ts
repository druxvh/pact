/**
 * VibeParty reference relay.
 *
 * pact works fully without this: with no relay a party syncs the YouTube tabs of ONE browser. Run a relay
 * (and point `WXT_VIBEPARTY_WS_URL` at it) to watch with friends on other computers.
 *
 * It is deliberately small and stateless-on-disk: rooms live in memory, a room is its code, and a room
 * disappears a while after the last person leaves. It runs the very same `Room` rules as the extension's
 * local hub (src/features/party/vibeparty/room.ts), so a live party and a local party behave identically.
 *
 * What it defends against (everything a client sends is untrusted):
 *   • malformed / oversized frames        — every frame is parsed + sanitised; payloads are capped at 16 KiB
 *   • flooding                            — per-connection token bucket, then disconnect
 *   • impersonation                       — a peer id belongs to the socket that joined with it; frames for
 *                                           peers a socket doesn't own are dropped
 *   • random web pages connecting         — optional Origin allow-list (`allowedOrigins`)
 *   • dead / half-open connections        — protocol-level ping every 30 s, terminate if unanswered
 *   • unbounded growth                    — caps on rooms, peers per room, queue length, chat history
 * It does NOT log chat content. Put TLS in front of it (Caddy, nginx, Cloudflare…) for `wss://`.
 */
import { type WebSocket, WebSocketServer } from 'ws';
import { type ChatMessage, type MediaSnapshot, type QueueItem, type ReactionEvent, type ServerMessage, parseYouTubeId } from '../src/features/party/vibeparty/protocol.ts';
import { Room } from '../src/features/party/vibeparty/room.ts';
import { parseClientMessage } from '../src/features/party/vibeparty/sanitize.ts';

export type RelayOptions = {
  /** 0 picks a free port (used by the tests). Default 8787. */
  port?: number;
  /** Default 127.0.0.1 — set to 0.0.0.0 deliberately when deploying. */
  host?: string;
  /** If set, only WebSocket upgrades carrying one of these `Origin`s are accepted, e.g. `chrome-extension://<id>`. */
  allowedOrigins?: string[];
  maxRooms?: number;
  maxPayloadBytes?: number;
  /** Sustained messages per second per connection (burst allows 2×). */
  ratePerSecond?: number;
  emptyRoomTtlMs?: number;
  heartbeatMs?: number;
  now?: () => number;
  log?: (line: string) => void;
};

export type Relay = {
  port: number;
  stats(): { connections: number; rooms: number; peers: number };
  close(): Promise<void>;
};

type PeerRecord = { socket: WebSocket; room: string; name: string };
type Connection = { peers: Set<string>; tokens: number; refilledAt: number; strikes: number; alive: boolean };

const MAX_STRIKES = 100;

export async function startRelay(options: RelayOptions = {}): Promise<Relay> {
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => {});
  const maxRooms = options.maxRooms ?? 500;
  const rate = options.ratePerSecond ?? 30;
  const burst = rate * 2;
  const emptyTtl = options.emptyRoomTtlMs ?? 10 * 60_000;

  const rooms = new Map<string, Room>();
  const peers = new Map<string, PeerRecord>();
  const conns = new Map<WebSocket, Connection>();

  const wss = new WebSocketServer({
    port: options.port ?? 8787,
    host: options.host ?? '127.0.0.1',
    maxPayload: options.maxPayloadBytes ?? 16 * 1024,
    verifyClient: options.allowedOrigins
      ? ({ origin }: { origin: string }) => options.allowedOrigins?.includes(origin) ?? false
      : undefined,
  });
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });

  // ── sending ────────────────────────────────────────────────────────────────

  const sendTo = (socket: WebSocket, msg: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };

  /** Everyone in the room — once per socket, since one browser hosts several peers on a single socket. */
  const broadcast = (roomId: string, msg: ServerMessage, except?: WebSocket) => {
    const targets = new Set<WebSocket>();
    for (const rec of peers.values()) if (rec.room === roomId && rec.socket !== except) targets.add(rec.socket);
    for (const s of targets) sendTo(s, msg);
  };

  const sendError = (socket: WebSocket, code: string, message: string) => sendTo(socket, { t: 'error', code, message });

  // ── membership ─────────────────────────────────────────────────────────────

  const removePeer = (peerId: string) => {
    const rec = peers.get(peerId);
    if (!rec) return;
    peers.delete(peerId);
    conns.get(rec.socket)?.peers.delete(peerId);
    const room = rooms.get(rec.room);
    if (!room) return;
    room.leave(peerId);
    broadcast(room.id, { t: 'presence', room: room.id, peers: room.peers() });
  };

  // ── protocol ───────────────────────────────────────────────────────────────

  const handle = (socket: WebSocket, conn: Connection, raw: unknown) => {
    const msg = parseClientMessage(raw);
    if (!msg) return;

    if (msg.t === 'ping') {
      sendTo(socket, { t: 'pong', ts: msg.ts });
      return;
    }

    if (msg.t === 'join') {
      const existing = peers.get(msg.peerId);
      if (existing && existing.socket !== socket) {
        sendError(socket, 'peer_taken', 'That peer id is already in use.');
        return;
      }
      if (existing && existing.room !== msg.room) removePeer(msg.peerId);
      if (!rooms.has(msg.room) && rooms.size >= maxRooms) {
        sendError(socket, 'server_full', 'This relay is full. Try again later.');
        return;
      }
      let room = rooms.get(msg.room);
      if (!room) {
        room = new Room(msg.room, now);
        rooms.set(msg.room, room);
      }
      if (room.join(msg.peerId, msg.name) === 'full') {
        if (room.size === 0) rooms.delete(msg.room);
        sendError(socket, 'room_full', 'This room is full.');
        return;
      }
      peers.set(msg.peerId, { socket, room: msg.room, name: msg.name });
      conn.peers.add(msg.peerId);
      sendTo(socket, { t: 'state', room: msg.room, peers: room.peers(), queue: room.sortedQueue(), chat: room.chat(), media: room.snapshot() });
      broadcast(msg.room, { t: 'presence', room: msg.room, peers: room.peers() });
      return;
    }

    // Everything else must come from the socket that owns this peer, for the room that peer is in.
    const rec = peers.get(msg.peerId);
    if (!rec || rec.socket !== socket || rec.room !== msg.room) return;
    const room = rooms.get(msg.room);
    if (!room) return;

    switch (msg.t) {
      case 'leave':
        removePeer(msg.peerId);
        return;

      case 'media': {
        if (msg.ev === 'ended') {
          const res = room.onEnded(msg.peerId, msg.videoId, msg.mediaTime);
          if (res.queueChanged) broadcast(room.id, { t: 'queue', room: room.id, items: room.sortedQueue() });
          if (res.snapshot) {
            // On advance the origin must navigate too; otherwise it already knows.
            broadcast(room.id, { t: 'media', room: room.id, from: res.advanced ? null : msg.peerId, media: res.snapshot }, res.advanced ? undefined : socket);
          }
          return;
        }
        const media: MediaSnapshot = room.applyMedia(msg.peerId, msg.ev, msg.mediaTime, msg.playing, msg.videoId);
        broadcast(room.id, { t: 'media', room: room.id, from: msg.peerId, media }, socket);
        return;
      }

      case 'chat': {
        const message: ChatMessage = { id: msg.id, peerId: msg.peerId, name: rec.name, text: msg.text, at: now() };
        if (room.addChat(message)) broadcast(room.id, { t: 'chat', room: room.id, message }, socket);
        return;
      }

      case 'reaction': {
        const reaction: ReactionEvent = { id: msg.id, peerId: msg.peerId, name: rec.name, emoji: msg.emoji, messageId: msg.messageId, at: now() };
        broadcast(room.id, { t: 'reaction', room: room.id, reaction }, socket);
        return;
      }

      case 'queue:add': {
        const item: QueueItem = {
          id: msg.id,
          url: msg.url,
          videoId: parseYouTubeId(msg.url) ?? '', // sanitised already
          title: msg.title,
          addedBy: msg.peerId,
          addedByName: rec.name,
          voters: [msg.peerId],
          createdAt: now(),
        };
        // Whether it was added, a duplicate or the queue is full, everyone (origin included) gets the authoritative list.
        room.addQueue(item);
        broadcast(room.id, { t: 'queue', room: room.id, items: room.sortedQueue() });
        return;
      }

      case 'queue:vote':
        if (room.vote(msg.id, msg.peerId)) broadcast(room.id, { t: 'queue', room: room.id, items: room.sortedQueue() });
        return;

      case 'queue:remove':
        if (room.removeQueue(msg.id, msg.peerId)) broadcast(room.id, { t: 'queue', room: room.id, items: room.sortedQueue() });
        return;

      default:
        return;
    }
  };

  // ── connections ────────────────────────────────────────────────────────────

  wss.on('connection', (socket) => {
    const conn: Connection = { peers: new Set(), tokens: burst, refilledAt: now(), strikes: 0, alive: true };
    conns.set(socket, conn);
    log(`connection opened (${conns.size} open)`);

    socket.on('pong', () => {
      conn.alive = true;
    });

    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      // token bucket
      const t = now();
      conn.tokens = Math.min(burst, conn.tokens + ((t - conn.refilledAt) / 1000) * rate);
      conn.refilledAt = t;
      if (conn.tokens < 1) {
        if (++conn.strikes >= MAX_STRIKES) socket.close(1008, 'rate limit');
        return;
      }
      conn.tokens -= 1;

      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return;
      }
      try {
        handle(socket, conn, parsed);
      } catch (err) {
        log(`handler error: ${(err as Error).message}`); // never let one client's frame take the relay down
      }
    });

    socket.on('close', () => {
      for (const peerId of [...conn.peers]) removePeer(peerId);
      conns.delete(socket);
      log(`connection closed (${conns.size} open)`);
    });
    socket.on('error', () => socket.terminate());
  });

  // ── housekeeping ───────────────────────────────────────────────────────────

  const heartbeat = setInterval(() => {
    for (const [socket, conn] of conns) {
      if (!conn.alive) {
        socket.terminate();
        continue;
      }
      conn.alive = false;
      socket.ping();
    }
  }, options.heartbeatMs ?? 30_000);

  const sweep = setInterval(() => {
    for (const [id, room] of rooms) {
      if (room.size === 0 && room.emptySince !== null && now() - room.emptySince > emptyTtl) rooms.delete(id);
    }
  }, 60_000);
  heartbeat.unref();
  sweep.unref();

  const address = wss.address();
  const port = typeof address === 'object' && address ? address.port : (options.port ?? 8787);

  return {
    port,
    stats: () => ({ connections: conns.size, rooms: rooms.size, peers: peers.size }),
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        clearInterval(sweep);
        for (const socket of conns.keys()) socket.terminate();
        wss.close(() => resolve());
      }),
  };
}
