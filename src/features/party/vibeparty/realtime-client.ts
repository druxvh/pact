/**
 * VibeParty's transport: one private Supabase Realtime channel per room (`party:<room code>`), carrying
 *
 *   • Presence  — who is here (each browser lists its YouTube tabs as peers) and which browser currently claims the hub role;
 *   • Broadcast — `c` events (a member's message to the hub) and `s` events (the hub's answers and fan-out).
 *
 * Replaces the standalone WebSocket relay: instead of a server running the room's rules, one member does (`RoomHub`, hub.ts)
 * and everyone else behaves exactly as they did towards the relay. The controller (controller.ts) can't tell the difference:
 * it hands this class `ClientMessage`s and receives `ServerMessage`s.
 *
 * ── The hub ────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * A member claims the role by tracking `hub: true` in its Presence entry, seeding the hub from its own copy of the room (so a
 * replacement hub *continues* the room rather than resetting it). Rules, all computed from Presence so every member agrees:
 *   1. If anyone claims it, the claimer with the smallest client id is the hub (two simultaneous claims resolve at once —
 *      the other steps down and asks the winner for the room's state).
 *   2. If nobody does (a new room, or the hub left), members claim in order of client id, a few hundred milliseconds apart — the
 *      first claim reaches the others before their own turn, so there is normally exactly one. Alone in the room: immediately.
 *   3. A hub that stops answering pings (a crashed browser whose Presence entry lingers) is suspected for a while and treated
 *      as absent, so a dead hub never stalls the room until Presence times it out.
 * While there is no hub, outgoing messages wait in a small bounded outbox and are sent when one is established.
 *
 * ── Identity & reconnecting ───────────────────────────────────────────────────────────────────────────────────────────
 * Presence is keyed by a stable per-browser `clientId`, and each entry carries a monotonically increasing `seq`. A browser
 * that reconnects keeps its key; if the server still holds the old entry, the newest `seq` wins — there is no "peer id already
 * in use" error to trip over. Peer ids (one per YouTube tab) are stable too: the controller persists them (see host.ts).
 *
 * ── Trust ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * Anyone holding the room code can join and send arbitrary JSON. Every inbound payload is size-capped, rate-limited per
 * sending client, parsed through sanitize.ts and dropped if it doesn't fit. Authorization of the channel itself is the
 * database's job (supabase/migrations/*_party_realtime.sql).
 */
import { type Outgoing, RoomHub, type RosterEntry } from './hub.ts';
import {
  type ClientMessage,
  LIMITS,
  type LinkReason,
  type LinkStatus,
  type PeerInfo,
  type PresenceMeta,
  type RoomState,
  type ServerMessage,
  topicFor,
  WIRE,
} from './protocol.ts';
import { cleanId, jsonBytes, parseClientEnvelope, parsePresenceMeta, parseServerEnvelope } from './sanitize.ts';

// ── what the controller sees ─────────────────────────────────────────────────

/** The controller's view of the room link. */
export type Transport = {
  /** Where this room's connection stands (`local` when there is no account / backend to connect with). */
  status(room: string): LinkStatus;
  /** Can a party reach other people right now? (`reason` says why not.) */
  availability(): { online: boolean; reason?: LinkReason };
  /** False when the message wasn't sent (not connected). Joins and leaves are always accepted. */
  send(msg: ClientMessage): boolean;
  /** Retry rooms that are waiting out a failure now instead of at the next backoff. */
  retry(): void;
};

export type TransportHandlers = {
  /** A room's link changed (connecting → live → reconnecting …). */
  onStatus(room: string, status: LinkStatus): void;
  onMessage(msg: ServerMessage): void;
  /** Estimated ONE-WAY latency to the hub in ms (smoothed). */
  onLatency(ms: number): void;
};

// ── what we need from supabase-js (a structural subset, so tests can fake it) ─

export type ChannelLike = {
  on(type: 'broadcast', filter: { event: string }, cb: (message: { payload?: unknown }) => void): ChannelLike;
  on(type: 'presence', filter: { event: 'sync' }, cb: () => void): ChannelLike;
  subscribe(cb?: (status: string, err?: Error) => void): ChannelLike;
  send(args: { type: 'broadcast'; event: string; payload: unknown }): Promise<unknown>;
  track(payload: Record<string, unknown>): Promise<unknown>;
  presenceState(): Record<string, unknown[]>;
};

export type RealtimeLike = {
  channel(
    topic: string,
    options: { config: { private: boolean; broadcast: { self: boolean; ack: boolean }; presence: { key: string; enabled: boolean } } },
  ): ChannelLike;
  removeChannel(channel: ChannelLike): Promise<unknown>;
  auth: {
    getSession(): Promise<{ data: { session: { user: { id: string } } | null } }>;
    onAuthStateChange(cb: (event: string, session: { user: { id: string } } | null) => void): { data: { subscription: { unsubscribe(): void } } };
  };
};

export type RealtimeOptions = {
  /** null = this build has no backend configured: every party stays local. */
  client: RealtimeLike | null;
  /** Stable per-browser id (Presence key). */
  clientId: string;
  /** The controller's current copy of a room — what a newly elected hub continues from. */
  getRoomState(room: string): RoomState | null;
  now?: () => number;
  random?: () => number;
  timings?: Partial<Timings>;
};

export type Timings = {
  claimDelayMs: number;
  /** Each member further down the client-id order waits this much longer (so the first claim is seen before the next member's turn). */
  claimStepMs: number;
  claimJitterMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  /** A refused channel is retried this slowly (after one quick retry that lets an expired token refresh). */
  deniedRetryMs: number;
  /** No SUBSCRIBED this long after opening a channel = failed attempt. */
  joinTimeoutMs: number;
  /** Connected this long = the previous failures are forgotten (so flapping keeps its backoff). */
  stableMs: number;
  pingMs: number;
  /** A hub silent this long is suspected dead. */
  hubSilenceMs: number;
  suspectMs: number;
  outboxMax: number;
  outboxTtlMs: number;
  /** First-ever connection attempts that fail this many times show an error (retrying continues). */
  errorAfterAttempts: number;
};

const DEFAULT_TIMINGS: Timings = {
  claimDelayMs: 100,
  claimStepMs: 300,
  claimJitterMs: 50,
  retryBaseMs: 1_000,
  retryMaxMs: 30_000,
  deniedRetryMs: 60_000,
  joinTimeoutMs: 15_000,
  stableMs: 20_000,
  pingMs: 5_000,
  hubSilenceMs: 15_000,
  suspectMs: 180_000,
  outboxMax: 50,
  outboxTtlMs: 15_000,
  errorAfterAttempts: 4,
};

/** Inbound limits per sending client (`c`), and for everything the hub says (`s`). Outbound is limited too — Realtime drops a client that floods. */
const RATE = {
  fromClient: { perSecond: 30, burst: 60 },
  fromHub: { perSecond: 200, burst: 400 },
  outbound: { perSecond: 20, burst: 40 },
  trackedClients: 64,
} as const;

// ── internals ────────────────────────────────────────────────────────────────

type Bucket = { tokens: number; at: number };
const bucket = (burst: number, now: number): Bucket => ({ tokens: burst, at: now });
function take(b: Bucket, now: number, rule: { perSecond: number; burst: number }): boolean {
  b.tokens = Math.min(rule.burst, b.tokens + (Math.max(0, now - b.at) / 1000) * rule.perSecond);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

type Entry = PresenceMeta & { clientId: string };

type Link = {
  room: string;
  /** Local peers (one per YouTube tab in this browser) → display name. */
  peers: Map<string, string>;
  channel: ChannelLike | null;
  /** Bumped whenever the channel is replaced, so callbacks of an old one are ignored. */
  gen: number;
  status: LinkStatus;
  everLive: boolean;
  subscribed: boolean;
  tracked: boolean;
  attempts: number;
  /** The channel generation whose failure we already handled — supabase-js repeats its error callback on every failed rejoin. */
  failedGen: number;
  deniedStrikes: number;
  seq: number;
  myClaim: boolean;
  hub: RoomHub | null;
  hubId: string | null;
  entries: Entry[];
  lastRoster: string;
  suspects: Map<string, number>;
  lastPong: number;
  outbox: Array<{ msg: ClientMessage; at: number }>;
  /** What we sent through our own hub since claiming it: if the claim loses to someone else's, it is sent to the winner. */
  sinceClaim: Array<{ msg: ClientMessage; at: number }>;
  fromClient: Map<string, Bucket>;
  fromHub: Bucket;
  outbound: Bucket;
  retryTimer?: ReturnType<typeof setTimeout>;
  watchdog?: ReturnType<typeof setTimeout>;
  stableTimer?: ReturnType<typeof setTimeout>;
  claimTimer?: ReturnType<typeof setTimeout>;
  pingTimer?: ReturnType<typeof setInterval>;
};

const DENIED = /unauthori[sz]ed|not authori[sz]ed|permission|policy|forbidden|denied|jwt|token/i;

/** One Presence entry per client key: the newest valid one (a reconnect can leave an older entry behind for a while). */
export function readPresence(state: Record<string, unknown[]>): Entry[] {
  const out: Entry[] = [];
  for (const [key, metas] of Object.entries(state)) {
    const clientId = cleanId(key);
    if (!clientId || !Array.isArray(metas)) continue;
    let best: PresenceMeta | null = null;
    for (const raw of metas.slice(0, 8)) {
      if (jsonBytes(raw) > WIRE.presenceBytes) continue;
      const meta = parsePresenceMeta(raw);
      if (meta && (!best || meta.seq > best.seq)) best = meta;
    }
    if (best) out.push({ ...best, clientId });
    if (out.length >= LIMITS.peersPerRoom * 2) break;
  }
  return out.sort((a, b) => (a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0));
}

export class RealtimeTransport implements Transport {
  private readonly links = new Map<string, Link>();
  private readonly t: Timings;
  private readonly now: () => number;
  private readonly random: () => number;
  private session: 'unknown' | 'in' | 'out' = 'unknown';
  private userId: string | null = null;
  private unsubscribeAuth: (() => void) | null = null;
  private smoothed: number | null = null;
  private started = false;

  constructor(
    private readonly opts: RealtimeOptions,
    private readonly handlers: TransportHandlers,
  ) {
    this.t = { ...DEFAULT_TIMINGS, ...opts.timings };
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
  }

  private get client(): RealtimeLike | null {
    return this.opts.client;
  }
  private get me(): string {
    return this.opts.clientId;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  /** Watch the Supabase session. Rooms opened before the session is known simply wait ("connecting"). */
  start(): void {
    if (this.started) return;
    this.started = true;
    const client = this.client;
    if (!client) return;
    // supabase-js holds an internal lock while it runs this callback: never call back into the client from inside it.
    const sub = client.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => this.onAuth(session?.user?.id ?? null), 0);
    });
    this.unsubscribeAuth = () => sub.data.subscription.unsubscribe();
    void client.auth.getSession().then(
      ({ data }) => this.onAuth(data.session?.user?.id ?? null),
      () => this.onAuth(null),
    );
  }

  /** Leave every room and stop. */
  stop(): void {
    this.unsubscribeAuth?.();
    this.unsubscribeAuth = null;
    this.started = false;
    for (const link of [...this.links.values()]) this.close(link);
    this.links.clear();
  }

  private onAuth(userId: string | null): void {
    const next = userId ? 'in' : 'out';
    if (next === this.session && userId === this.userId) return; // a token refresh, not a different person
    this.session = next;
    this.userId = userId;
    for (const link of this.links.values()) {
      // A private channel is authorised once, at join: a different user (or none) needs a fresh join.
      link.attempts = 0;
      link.deniedStrikes = 0;
      if (userId) {
        this.reset(link);
        this.setStatus(link, { mode: 'connecting' });
        void this.recreate(link);
      } else {
        this.close(link);
        this.setStatus(link, this.localStatus());
      }
    }
  }

  private localStatus(): LinkStatus {
    return { mode: 'local', reason: this.client ? 'signed-out' : 'unconfigured' };
  }

  // ── Transport ──────────────────────────────────────────────────────────────

  status(room: string): LinkStatus {
    if (!this.client) return { mode: 'local', reason: 'unconfigured' };
    if (this.session === 'out') return this.localStatus();
    return this.links.get(room)?.status ?? { mode: 'connecting' };
  }

  availability(): { online: boolean; reason?: LinkReason } {
    if (!this.client) return { online: false, reason: 'unconfigured' };
    if (this.session === 'out') return { online: false, reason: 'signed-out' };
    return { online: true };
  }

  send(msg: ClientMessage): boolean {
    if (msg.t === 'join') {
      this.joinPeer(msg.room, msg.peerId, msg.name);
      return true;
    }
    if (msg.t === 'leave') {
      this.leavePeer(msg.room, msg.peerId);
      return true;
    }
    if (msg.t === 'ping') return false; // pings are this class's own business

    const link = this.links.get(msg.room);
    if (link?.status.mode !== 'live' || !link.peers.has(msg.peerId)) return false;
    if (!take(link.outbound, this.now(), RATE.outbound)) return false;
    this.dispatch(link, msg);
    return true;
  }

  retry(): void {
    for (const link of this.links.values()) {
      if (this.session !== 'in' || link.status.mode === 'live' || link.status.mode === 'local') continue;
      clearTimeout(link.retryTimer);
      link.attempts = 0;
      link.deniedStrikes = 0;
      void this.recreate(link);
    }
  }

  // ── membership ─────────────────────────────────────────────────────────────

  private joinPeer(room: string, peerId: string, name: string): void {
    let link = this.links.get(room);
    if (!link) {
      link = this.newLink(room);
      this.links.set(room, link);
      link.peers.set(peerId, name);
      if (!this.client) return;
      if (this.session === 'out') this.setStatus(link, this.localStatus());
      else if (this.session === 'in') this.open(link);
      return;
    }
    const changed = link.peers.get(peerId) !== name;
    link.peers.set(peerId, name);
    if (changed && link.tracked) {
      void this.announce(link);
      this.deliverRoster(link);
    }
  }

  private leavePeer(room: string, peerId: string): void {
    const link = this.links.get(room);
    if (!link) return;
    link.peers.delete(peerId);
    if (link.peers.size === 0) {
      this.links.delete(room);
      this.close(link); // Presence tells the others we are gone — and with us the hub, if we were it
    } else if (link.tracked) {
      void this.announce(link);
      this.deliverRoster(link);
    }
  }

  private newLink(room: string): Link {
    const now = this.now();
    return {
      room,
      peers: new Map(),
      channel: null,
      gen: 0,
      status: this.session === 'out' || !this.client ? this.localStatus() : { mode: 'connecting' },
      everLive: false,
      subscribed: false,
      tracked: false,
      attempts: 0,
      failedGen: -1,
      deniedStrikes: 0,
      seq: 0,
      myClaim: false,
      hub: null,
      hubId: null,
      entries: [],
      lastRoster: '',
      suspects: new Map(),
      lastPong: now,
      outbox: [],
      sinceClaim: [],
      fromClient: new Map(),
      fromHub: bucket(RATE.fromHub.burst, now),
      outbound: bucket(RATE.outbound.burst, now),
    };
  }

  // ── channel lifecycle ──────────────────────────────────────────────────────

  private open(link: Link): void {
    const client = this.client;
    if (!client || this.session !== 'in' || link.channel || !this.links.has(link.room)) return;
    const gen = ++link.gen;
    let channel: ChannelLike;
    try {
      channel = client.channel(topicFor(link.room), {
        config: { private: true, broadcast: { self: false, ack: false }, presence: { key: this.me, enabled: true } },
      });
      channel
        .on('broadcast', { event: WIRE.clientEvent }, (m) => this.onClientEvent(link, gen, m.payload))
        .on('broadcast', { event: WIRE.serverEvent }, (m) => this.onServerEvent(link, gen, m.payload))
        .on('presence', { event: 'sync' }, () => this.onSync(link, gen))
        .subscribe((status, err) => this.onSubscribe(link, gen, status, err));
    } catch (err) {
      // e.g. supabase-js handed back a channel it still considered joined; start over after the backoff.
      link.channel = null;
      this.lost(link, err instanceof Error ? err : String(err));
      return;
    }
    link.channel = channel;
    clearTimeout(link.watchdog);
    link.watchdog = setTimeout(() => {
      if (link.gen === gen && !link.subscribed && link.failedGen !== gen) {
        link.failedGen = gen;
        this.lost(link, 'timed out');
      }
    }, this.t.joinTimeoutMs);
  }

  private onSubscribe(link: Link, gen: number, status: string, err?: Error): void {
    if (gen !== link.gen) return;
    if (status === 'SUBSCRIBED') {
      clearTimeout(link.watchdog);
      clearTimeout(link.retryTimer); // it came back by itself (supabase-js rejoins after a socket reconnect)
      link.failedGen = -1;
      link.subscribed = true;
      void this.announce(link).then((ok) => {
        if (gen !== link.gen || !link.subscribed) return; // the channel failed while the track call was in flight
        if (ok) this.becameLive(link);
        else this.lost(link, 'presence rejected');
      });
      return;
    }
    // CHANNEL_ERROR | TIMED_OUT | CLOSED — and again on every failed rejoin; only the first counts, or the backoff would never elapse.
    if (link.failedGen === gen) return;
    link.failedGen = gen;
    this.lost(link, err ?? status);
  }

  private becameLive(link: Link): void {
    if (link.tracked && link.status.mode === 'live') return;
    link.tracked = true;
    link.everLive = true;
    this.setStatus(link, { mode: 'live' });
    clearTimeout(link.stableTimer);
    link.stableTimer = setTimeout(() => {
      link.attempts = 0;
      link.deniedStrikes = 0;
    }, this.t.stableMs);
    clearInterval(link.pingTimer);
    link.pingTimer = setInterval(() => this.tickPing(link), this.t.pingMs);
    // Presence may already have told us who is here (and that we are too) before the track call was acknowledged.
    if (link.entries.some((e) => e.clientId === this.me)) this.evaluate(link);
  }

  /** The channel went away or never came up. */
  private lost(link: Link, why: Error | string): void {
    if (!this.links.has(link.room)) return;
    const message = why instanceof Error ? why.message : why;
    this.releaseHub(link);
    link.subscribed = false;
    link.tracked = false;
    link.entries = [];
    clearTimeout(link.stableTimer);
    clearTimeout(link.watchdog);
    clearInterval(link.pingTimer);
    if (DENIED.test(message)) {
      link.deniedStrikes += 1;
      void this.dropChannel(link);
      if (link.deniedStrikes === 1) {
        // The first refusal is often just an expired token: ask for a fresh session, then try once more quickly.
        void this.client?.auth.getSession().catch(() => {});
        this.setStatus(link, { mode: link.everLive ? 'reconnecting' : 'connecting' });
        this.scheduleRetry(link, 3_000);
      } else {
        this.setStatus(link, {
          mode: 'error',
          reason: 'denied',
          message: 'The server refused this room. Sign out and back in; if it keeps happening, the project’s Realtime rules need applying.',
        });
        this.scheduleRetry(link, this.t.deniedRetryMs);
      }
      return;
    }
    link.attempts += 1;
    if (!link.everLive && link.attempts >= this.t.errorAfterAttempts) {
      this.setStatus(link, { mode: 'error', reason: 'failed', message: 'Can’t reach the party server. Still trying…' });
    } else {
      this.setStatus(link, { mode: link.everLive ? 'reconnecting' : 'connecting' });
    }
    // supabase-js may rejoin by itself first; if it hasn't by then, we start over with a fresh channel.
    this.scheduleRetry(link, this.backoff(link.attempts));
  }

  private backoff(attempts: number): number {
    const base = Math.min(this.t.retryMaxMs, this.t.retryBaseMs * 2 ** Math.max(0, attempts - 1));
    return base * (0.75 + this.random() * 0.5);
  }

  private scheduleRetry(link: Link, ms: number): void {
    clearTimeout(link.retryTimer);
    link.retryTimer = setTimeout(() => void this.recreate(link), ms);
  }

  private async recreate(link: Link): Promise<void> {
    clearTimeout(link.retryTimer);
    await this.dropChannel(link);
    if (this.links.get(link.room) === link) this.open(link);
  }

  private async dropChannel(link: Link): Promise<void> {
    const channel = link.channel;
    link.channel = null;
    link.gen += 1;
    link.subscribed = false;
    link.tracked = false;
    link.entries = [];
    if (channel) await this.client?.removeChannel(channel).catch(() => {});
  }

  /** Stop the room's timers and give up the hub role. Doesn't touch the channel or the link's status. */
  private reset(link: Link): void {
    clearTimeout(link.retryTimer);
    clearTimeout(link.watchdog);
    clearTimeout(link.stableTimer);
    clearInterval(link.pingTimer);
    this.releaseHub(link);
  }

  /** Stop everything for a room (we left it, or we're signed out). Doesn't touch the link's status. */
  private close(link: Link): void {
    this.reset(link);
    void this.dropChannel(link);
  }

  private setStatus(link: Link, status: LinkStatus): void {
    const prev = link.status;
    if (prev.mode === status.mode && prev.reason === status.reason && prev.message === status.message) return;
    link.status = status;
    this.handlers.onStatus(link.room, status);
  }

  // ── presence, roster, hub election ─────────────────────────────────────────

  private meta(link: Link): PresenceMeta {
    link.seq = Math.max(link.seq + 1, this.now());
    return { v: 1, seq: link.seq, hub: link.myClaim, peers: [...link.peers].map(([id, name]) => ({ id, name })) };
  }

  /** (Re)publish our Presence entry. Resolves false if the server didn't take it. */
  private async announce(link: Link): Promise<boolean> {
    const channel = link.channel;
    if (!channel || !link.subscribed) return false;
    try {
      const res = await channel.track(this.meta(link) as unknown as Record<string, unknown>);
      return res === 'ok' || res === undefined;
    } catch {
      return false;
    }
  }

  private onSync(link: Link, gen: number): void {
    if (gen !== link.gen || !link.channel) return;
    link.entries = readPresence(link.channel.presenceState());
    link.hub?.setRoster(this.rosterEntries(link));
    this.deliverRoster(link);
    // Only decide about the hub from a state that includes us: that is the first one that can't be missing earlier members
    // (claiming from a snapshot taken before the room's state arrived would crown us over a hub that already exists).
    if (link.entries.some((e) => e.clientId === this.me)) this.evaluate(link);
  }

  /** Entries for the hub: what Presence says, with our own peers always current. */
  private rosterEntries(link: Link): RosterEntry[] {
    const own: RosterEntry = { clientId: this.me, peers: [...link.peers].map(([id, name]) => ({ id, name })) };
    return [...link.entries.filter((e) => e.clientId !== this.me).map((e) => ({ clientId: e.clientId, peers: e.peers })), own].sort((a, b) =>
      a.clientId < b.clientId ? -1 : a.clientId > b.clientId ? 1 : 0,
    );
  }

  private rosterOf(link: Link): PeerInfo[] {
    const seen = new Set<string>();
    const out: PeerInfo[] = [];
    for (const e of this.rosterEntries(link)) {
      for (const p of e.peers) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        out.push(p);
      }
    }
    return out.slice(0, LIMITS.peersPerRoom);
  }

  private deliverRoster(link: Link): void {
    const peers = this.rosterOf(link);
    const key = JSON.stringify(peers);
    if (key === link.lastRoster) return;
    link.lastRoster = key;
    this.handlers.onMessage({ t: 'presence', room: link.room, peers });
  }

  private amHub(link: Link): boolean {
    return link.myClaim && link.hub !== null && link.hubId === this.me;
  }

  private evaluate(link: Link): void {
    if (!link.tracked) return;
    const now = this.now();
    for (const [id, until] of link.suspects) if (until <= now || !link.entries.some((e) => e.clientId === id)) link.suspects.delete(id);

    const claimers = link.entries.filter((e) => e.hub && e.clientId !== this.me && !link.suspects.has(e.clientId)).map((e) => e.clientId);
    if (link.myClaim) claimers.push(this.me); // our own claim may not have come back through Presence yet
    claimers.sort();
    const winner = claimers[0] ?? null;

    const before = link.hubId;
    link.hubId = winner;
    if (link.myClaim && winner !== this.me) {
      this.stepDown(link);
    } else if (winner === null) {
      this.scheduleClaim(link);
    } else {
      clearTimeout(link.claimTimer);
      link.claimTimer = undefined;
    }
    if (link.hubId !== before) this.hubChanged(link);
  }

  private scheduleClaim(link: Link): void {
    if (link.claimTimer) return;
    const present = link.entries.filter((e) => !link.suspects.has(e.clientId)).map((e) => e.clientId);
    const others = present.some((id) => id !== this.me);
    // Our turn: how many members come before us in client-id order.
    const rank = Math.max(0, present.filter((id) => id < this.me).length);
    const delay = others ? Math.min(3_000, this.t.claimDelayMs + rank * this.t.claimStepMs + this.random() * this.t.claimJitterMs) : 0;
    link.claimTimer = setTimeout(() => this.claim(link), delay);
  }

  private claim(link: Link): void {
    link.claimTimer = undefined;
    if (!link.tracked || link.myClaim || !link.channel) return;
    if (link.entries.some((e) => e.hub && e.clientId !== this.me && !link.suspects.has(e.clientId))) return; // someone beat us to it
    const hub = new RoomHub(link.room, this.now);
    const state = this.opts.getRoomState(link.room);
    if (state) hub.seed(state);
    hub.setRoster(this.rosterEntries(link));
    link.hub = hub;
    link.myClaim = true;
    link.sinceClaim = [];
    link.hubId = this.me;
    void this.announce(link);
    this.hubChanged(link);
  }

  private stepDown(link: Link): void {
    link.myClaim = false;
    link.hub = null;
    // Whatever we did as a hub that lost the election never reached the others: hand it to the winner.
    link.outbox.push(...link.sinceClaim.splice(0));
    while (link.outbox.length > this.t.outboxMax) link.outbox.shift();
    void this.announce(link);
  }

  private releaseHub(link: Link): void {
    clearTimeout(link.claimTimer);
    link.claimTimer = undefined;
    link.myClaim = false;
    link.hub = null;
    link.hubId = null;
  }

  /** Someone (maybe us) is the hub now, or nobody is. */
  private hubChanged(link: Link): void {
    if (link.hubId === null) return;
    link.lastPong = this.now();
    if (this.amHub(link)) {
      this.flushOutbox(link);
      return;
    }
    // Ask the hub for the room as it sees it, so we end up with the hub's version rather than our own.
    const first = link.peers.entries().next().value;
    if (first) this.publishClient(link, { t: 'join', room: link.room, peerId: first[0], name: first[1] });
    this.flushOutbox(link);
    this.tickPing(link);
  }

  // ── sending ────────────────────────────────────────────────────────────────

  private dispatch(link: Link, msg: ClientMessage): void {
    if (this.amHub(link)) {
      this.rememberForHandover(link, msg);
      this.emit(link, link.hub?.handle(this.me, msg) ?? []);
      return;
    }
    if (link.hubId !== null) {
      this.publishClient(link, msg);
      return;
    }
    // No hub right now (it just left): hold on to it briefly.
    link.outbox.push({ msg, at: this.now() });
    if (link.outbox.length > this.t.outboxMax) link.outbox.shift();
  }

  /** Only what is safe to apply twice: a repeated vote would undo itself, a repeated reaction would play twice. */
  private rememberForHandover(link: Link, msg: ClientMessage): void {
    if (msg.t !== 'chat' && msg.t !== 'media' && msg.t !== 'queue:add' && msg.t !== 'queue:remove') return;
    const now = this.now();
    link.sinceClaim.push({ msg, at: now });
    while (link.sinceClaim.length > this.t.outboxMax || (link.sinceClaim[0] && now - link.sinceClaim[0].at > this.t.outboxTtlMs)) link.sinceClaim.shift();
  }

  private flushOutbox(link: Link): void {
    const now = this.now();
    const pending = link.outbox.splice(0);
    for (const item of pending) if (now - item.at <= this.t.outboxTtlMs) this.dispatch(link, item.msg);
  }

  private publishClient(link: Link, msg: ClientMessage): void {
    this.publish(link, WIRE.clientEvent, { from: this.me, msg }, WIRE.clientBytes);
  }

  private publishServer(link: Link, out: Outgoing): void {
    const payload: Record<string, unknown> = { msg: out.msg };
    if (out.to !== undefined) payload.to = out.to;
    if (out.except !== undefined) payload.except = out.except;
    this.publish(link, WIRE.serverEvent, payload, WIRE.serverBytes);
  }

  private publish(link: Link, event: string, payload: unknown, maxBytes: number): void {
    const channel = link.channel;
    if (!channel || !link.subscribed || jsonBytes(payload) > maxBytes) return;
    // Never let a failed send throw into the controller; a lost message is what "reconnecting" already tells the user.
    void channel.send({ type: 'broadcast', event, payload }).catch(() => {});
  }

  /** The hub's output: to whoever it names, and to ourselves if we are among them. */
  private emit(link: Link, outs: Outgoing[]): void {
    for (const out of outs) {
      const toMe = out.to === undefined ? out.except !== this.me : out.to === this.me;
      if (toMe) this.deliver(link, out.msg);
      if (out.to !== this.me) this.publishServer(link, out);
    }
  }

  private deliver(link: Link, msg: ServerMessage): void {
    if (msg.t === 'state') {
      // Presence is the authority on who is here — never the hub's (possibly stale) idea.
      this.handlers.onMessage({ ...msg, peers: this.rosterOf(link) });
      return;
    }
    this.handlers.onMessage(msg);
  }

  // ── receiving ──────────────────────────────────────────────────────────────

  /** `c`: a member talking to the hub. Everyone hears it; only the hub acts. */
  private onClientEvent(link: Link, gen: number, payload: unknown): void {
    if (gen !== link.gen || !this.amHub(link)) return;
    if (jsonBytes(payload) > WIRE.clientBytes) return;
    const env = parseClientEnvelope(payload);
    if (!env || env.from === this.me) return;
    if (!this.allowFrom(link, env.from)) return;
    this.emit(link, link.hub?.handle(env.from, env.msg) ?? []);
  }

  /** `s`: the hub talking to members. */
  private onServerEvent(link: Link, gen: number, payload: unknown): void {
    if (gen !== link.gen) return;
    if (!take(link.fromHub, this.now(), RATE.fromHub)) return;
    if (jsonBytes(payload) > WIRE.serverBytes) return;
    const env = parseServerEnvelope(payload);
    if (!env) return;
    if (env.to !== null && env.to !== this.me) return;
    if (env.except === this.me) return;
    const { msg } = env;
    if (msg.t === 'pong') {
      this.onPong(link, msg.ts);
      return;
    }
    if (msg.t === 'error' || msg.t === 'presence') return; // Presence is ours; hubs don't send errors
    if (msg.room !== link.room) return;
    if (this.amHub(link)) return; // two hubs for a moment: we keep our own version until Presence settles it
    this.deliver(link, msg);
  }

  private allowFrom(link: Link, from: string): boolean {
    const now = this.now();
    let b = link.fromClient.get(from);
    if (!b) {
      if (link.fromClient.size >= RATE.trackedClients) {
        const oldest = link.fromClient.keys().next().value;
        if (oldest !== undefined) link.fromClient.delete(oldest);
      }
      b = bucket(RATE.fromClient.burst, now);
      link.fromClient.set(from, b);
    }
    return take(b, now, RATE.fromClient);
  }

  // ── liveness & latency ─────────────────────────────────────────────────────

  private tickPing(link: Link): void {
    if (link.status.mode !== 'live' || link.hubId === null || this.amHub(link)) return;
    const now = this.now();
    if (now - link.lastPong > this.t.hubSilenceMs) {
      // The hub's Presence entry is still there but it no longer answers: treat it as gone and let someone take over.
      link.suspects.set(link.hubId, now + this.t.suspectMs);
      link.lastPong = now;
      this.evaluate(link);
      return;
    }
    this.publishClient(link, { t: 'ping', ts: now });
  }

  private onPong(link: Link, ts: number): void {
    const now = this.now();
    link.lastPong = now;
    if (link.hubId !== null) link.suspects.delete(link.hubId);
    const oneWay = Math.max(0, (now - ts) / 2);
    this.smoothed = this.smoothed === null ? oneWay : this.smoothed * 0.7 + oneWay * 0.3;
    this.handlers.onLatency(this.smoothed);
  }
}
