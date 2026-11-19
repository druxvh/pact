/**
 * A stand-in for Supabase Realtime, for tests only: it routes Broadcast and Presence between fake clients on the same
 * topic, with controllable latency, authorization, network drops and lingering ("ghost") Presence entries — the failure
 * modes the real transport has to survive. Nothing in the extension imports this.
 */
import type { ChannelLike, RealtimeLike } from './realtime-client.ts';

type Session = { user: { id: string } } | null;
type StatusCb = (status: string, err?: Error) => void;
type ChannelOptions = Parameters<RealtimeLike['channel']>[1];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export class FakeRealtimeServer {
  /** Delay (ms, on the fake timers) between a client pushing something and the server acting on it. */
  latencyMs = 5;
  /** Return an error message to refuse a client's join of a topic (what a missing RLS policy looks like), or null to allow. */
  authorize: (userId: string | null, topic: string) => string | null = (userId) =>
    userId ? null : 'Unauthorized: You do not have permissions to read from this Channel topic';
  /** Entries whose connection died without a clean goodbye: they stay in Presence until `expireGhosts()`. */
  private ghosts: Array<{ topic: string; key: string; meta: Record<string, unknown> }> = [];
  readonly channels = new Set<FakeChannel>();
  /** Everything broadcast, for assertions: [topic, event, payload]. */
  readonly log: Array<[string, string, unknown]> = [];
  /** Every time a client began claiming the hub role (Presence entry flipped to `hub: true`): who, in order. */
  readonly claims: string[] = [];

  inTopic(topic: string): FakeChannel[] {
    return [...this.channels].filter((c) => c.topic === topic && c.joined);
  }

  presence(topic: string): Record<string, Array<Record<string, unknown>>> {
    const state: Record<string, Array<Record<string, unknown>>> = {};
    let n = 0;
    const add = (key: string, meta: Record<string, unknown>, prefix: string) => {
      const list = state[key] ?? [];
      list.push({ ...clone(meta), presence_ref: `${prefix}${n++}` });
      state[key] = list;
    };
    for (const g of this.ghosts) if (g.topic === topic) add(g.key, g.meta, 'g');
    for (const c of this.inTopic(topic)) if (c.meta) add(c.key, c.meta, 'c');
    return state;
  }

  /** Push the current Presence state to everyone on the topic. Each client sees the snapshot as of now, one latency later. */
  sync(topic: string): void {
    const snapshot = this.presence(topic);
    for (const c of this.inTopic(topic)) {
      c.deliver(() => {
        c.view = snapshot;
        c.syncCb?.();
      });
    }
  }

  expireGhosts(): void {
    const topics = new Set(this.ghosts.map((g) => g.topic));
    this.ghosts = [];
    for (const t of topics) this.sync(t);
  }

  addGhost(topic: string, key: string, meta: Record<string, unknown>): void {
    this.ghosts.push({ topic, key, meta });
    this.sync(topic);
  }

  /** @internal */
  leaveWithGhost(channel: FakeChannel): void {
    if (channel.meta) this.ghosts.push({ topic: channel.topic, key: channel.key, meta: channel.meta });
  }
}

export class FakeChannel implements ChannelLike {
  joined = false;
  meta: Record<string, unknown> | null = null;
  syncCb: (() => void) | null = null;
  /** Presence as this client last heard it (not as the server has it right now). */
  view: Record<string, unknown[]> = {};
  statusCb: StatusCb | null = null;
  private readonly broadcastCbs = new Map<string, Array<(m: { payload?: unknown }) => void>>();
  readonly key: string;
  subscribed = false;

  constructor(
    readonly topic: string,
    options: ChannelOptions,
    private readonly client: FakeClient,
  ) {
    this.key = options.config.presence.key;
  }

  on(type: 'broadcast' | 'presence', filter: { event: string }, cb: ((m: { payload?: unknown }) => void) | (() => void)): ChannelLike {
    if (this.subscribed && type === 'presence') throw new Error('cannot add `presence` callbacks after `subscribe()`');
    if (type === 'presence') this.syncCb = cb as () => void;
    else this.broadcastCbs.set(filter.event, [...(this.broadcastCbs.get(filter.event) ?? []), cb as (m: { payload?: unknown }) => void]);
    return this;
  }

  subscribe(cb?: StatusCb): ChannelLike {
    this.subscribed = true;
    this.statusCb = cb ?? null;
    const server = this.client.server;
    setTimeout(() => {
      if (!this.client.channelsOpen.has(this)) return;
      if (this.client.offline) {
        cb?.('TIMED_OUT');
        return;
      }
      const refusal = server.authorize(this.client.userId, this.topic);
      if (refusal) {
        cb?.('CHANNEL_ERROR', new Error(refusal));
        return;
      }
      this.joined = true;
      cb?.('SUBSCRIBED');
      server.sync(this.topic);
    }, server.latencyMs);
    return this;
  }

  /** Run `fn` after the server's latency, unless the channel has been left in the meantime. */
  deliver(fn: () => void): void {
    setTimeout(() => {
      if (this.joined) fn();
    }, this.client.server.latencyMs);
  }

  async send(args: { type: 'broadcast'; event: string; payload: unknown }): Promise<unknown> {
    if (!this.joined) return 'error';
    const server = this.client.server;
    const payload = clone(args.payload);
    server.log.push([this.topic, args.event, payload]);
    for (const other of server.inTopic(this.topic)) {
      if (other === this) continue;
      other.deliver(() => {
        for (const cb of other.broadcastCbs.get(args.event) ?? []) cb({ payload: clone(payload) });
      });
    }
    return 'ok';
  }

  async track(payload: Record<string, unknown>): Promise<unknown> {
    if (!this.joined) return 'error';
    if (payload.hub === true && this.meta?.hub !== true) this.client.server.claims.push(this.key);
    this.meta = clone(payload);
    this.client.server.sync(this.topic);
    return 'ok';
  }

  presenceState(): Record<string, unknown[]> {
    return this.view;
  }

  /** Server-side: this channel's connection is gone. */
  kill(status: string, ghost = false): void {
    const wasJoined = this.joined;
    this.joined = false;
    if (ghost) this.client.server.leaveWithGhost(this);
    this.meta = null;
    this.client.server.sync(this.topic);
    if (wasJoined) this.statusCb?.(status, new Error('connection lost'));
  }
}

export class FakeClient implements RealtimeLike {
  readonly channelsOpen = new Set<FakeChannel>();
  offline = false;
  private session: Session;
  private listeners = new Set<(event: string, session: Session) => void>();
  /** How many times each topic was opened (a fresh channel per retry). */
  readonly opened: string[] = [];

  constructor(
    readonly server: FakeRealtimeServer,
    userId: string | null,
  ) {
    this.session = userId ? { user: { id: userId } } : null;
  }

  get userId(): string | null {
    return this.session?.user.id ?? null;
  }

  channel(topic: string, options: ChannelOptions): ChannelLike {
    const existing = [...this.channelsOpen].find((c) => c.topic === topic);
    if (existing) return existing;
    const channel = new FakeChannel(topic, options, this);
    this.channelsOpen.add(channel);
    this.server.channels.add(channel);
    this.opened.push(topic);
    return channel;
  }

  async removeChannel(channel: ChannelLike): Promise<unknown> {
    const c = channel as FakeChannel;
    const topic = c.topic;
    c.joined = false;
    c.meta = null;
    this.channelsOpen.delete(c);
    this.server.channels.delete(c);
    this.server.sync(topic);
    return 'ok';
  }

  auth: RealtimeLike['auth'] = {
    getSession: async () => ({ data: { session: this.session } }),
    onAuthStateChange: (cb) => {
      this.listeners.add(cb);
      return { data: { subscription: { unsubscribe: () => this.listeners.delete(cb) } } };
    },
  };

  setUser(userId: string | null): void {
    this.session = userId ? { user: { id: userId } } : null;
    for (const cb of this.listeners) cb(userId ? 'SIGNED_IN' : 'SIGNED_OUT', this.session);
  }

  /** The network dies: every channel errors out. `ghost` leaves the Presence entries behind, as a half-open connection does. */
  dropNetwork(ghost = false): void {
    this.offline = true;
    for (const c of [...this.channelsOpen]) c.kill('CHANNEL_ERROR', ghost);
  }

  restoreNetwork(): void {
    this.offline = false;
  }
}
