/**
 * The background script's single WebSocket to a VibeParty relay (shared by every YouTube tab in the browser).
 * Handles the unglamorous parts: reconnect with exponential backoff + jitter, a heartbeat that doubles as a
 * latency probe, and detecting half-open connections (the socket says "open" but nothing is flowing).
 */
import type { ClientMessage, ServerMessage } from './protocol.ts';
import { parseServerMessage } from './sanitize.ts';

export type RelayLike = {
  readonly connected: boolean;
  /** False when the message couldn't be sent (not connected). */
  send(msg: ClientMessage): boolean;
};

export type RelayHandlers = {
  onOpen(): void;
  onClose(): void;
  onMessage(msg: ServerMessage): void;
  /** Estimated ONE-WAY latency in ms (half the ping round trip, smoothed). */
  onLatency(ms: number): void;
};

export type RelayOptions = {
  WebSocketCtor?: typeof WebSocket;
  heartbeatMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
};

export class RelayClient implements RelayLike {
  connected = false;

  private socket: WebSocket | null = null;
  private attempts = 0;
  private stopped = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private lastActivity = 0;
  private smoothed: number | null = null;

  private readonly Ctor: typeof WebSocket;
  private readonly heartbeatMs: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly now: () => number;

  constructor(
    private readonly url: string,
    private readonly handlers: RelayHandlers,
    options: RelayOptions = {},
  ) {
    this.Ctor = options.WebSocketCtor ?? WebSocket;
    this.heartbeatMs = options.heartbeatMs ?? 25_000;
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeatTimer);
    this.reconnectTimer = undefined;
    this.heartbeatTimer = undefined;
    const s = this.socket;
    this.socket = null;
    if (this.connected) {
      this.connected = false;
      this.handlers.onClose();
    }
    s?.close();
  }

  send(msg: ClientMessage): boolean {
    if (!this.connected || !this.socket || this.socket.readyState !== 1 /* OPEN */) return false;
    try {
      this.socket.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  private connect(): void {
    if (this.stopped || this.socket) return;
    let socket: WebSocket;
    try {
      socket = new this.Ctor(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.connected = true;
      this.attempts = 0;
      this.lastActivity = this.now();
      this.startHeartbeat();
      this.handlers.onOpen();
      this.ping(); // measure latency right away
    });

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return;
      this.lastActivity = this.now();
      if (typeof event.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      const msg = parseServerMessage(parsed);
      if (!msg) return;
      if (msg.t === 'pong') {
        const oneWay = Math.max(0, (this.now() - msg.ts) / 2);
        this.smoothed = this.smoothed === null ? oneWay : this.smoothed * 0.7 + oneWay * 0.3;
        this.handlers.onLatency(this.smoothed);
        return;
      }
      this.handlers.onMessage(msg);
    });

    const dropped = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
      if (this.connected) {
        this.connected = false;
        this.handlers.onClose();
      }
      this.scheduleReconnect();
    };
    socket.addEventListener('close', dropped);
    socket.addEventListener('error', () => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      dropped();
    });
  }

  private ping(): void {
    this.send({ t: 'ping', ts: this.now() });
  }

  private startHeartbeat(): void {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      // Nothing heard for 2.5 heartbeats → the connection is half-open. Drop it and reconnect.
      if (this.now() - this.lastActivity > this.heartbeatMs * 2.5) {
        try {
          this.socket?.close();
        } catch {
          /* ignore */
        }
        return;
      }
      this.ping();
    }, this.heartbeatMs);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.attempts += 1;
    const delay = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (this.attempts - 1));
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = undefined;
        this.connect();
      },
      delay + Math.random() * 400,
    ); // jitter so a relay restart isn't a thundering herd
  }
}
