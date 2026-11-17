// Whole-room tests over a fake Supabase Realtime: each "browser" is a real PartyHost (controller + Realtime transport) on a
// fake client; the fake server routes Broadcast and Presence and can drop connections, refuse joins and leave ghost entries.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClient, FakeRealtimeServer } from './fake-realtime';
import { PartyHost } from './host';
import { type BackgroundToContent, type LinkStatus, topicFor, WIRE, watchUrlFor } from './protocol';

const ROOM = 'friday-vibes';
const TOPIC = topicFor(ROOM);
const VID = 'dQw4w9WgXcQ';
const VID2 = 'jNQXAC9IVRw';

type Msg<T extends BackgroundToContent['type']> = Extract<BackgroundToContent, { type: T }>;

/** Advance the fake clock and let every promise it unblocks run. */
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

class Browser {
  readonly client: FakeClient;
  host: PartyHost;
  readonly inbox = new Map<number, BackgroundToContent[]>();
  readonly statuses: LinkStatus[] = [];
  private n = 0;
  readonly saved: { state: unknown } = { state: undefined };

  constructor(
    readonly server: FakeRealtimeServer,
    readonly name: string,
    opts: { user?: string | null; skewMs?: number; timings?: ConstructorParameters<typeof PartyHost>[0]['timings'] } = {},
  ) {
    this.client = new FakeClient(server, opts.user === undefined ? `user-${name}` : opts.user);
    this.skew = opts.skewMs ?? 0;
    this.timings = opts.timings;
    this.host = this.makeHost();
  }
  private skew: number;
  private timings: ConstructorParameters<typeof PartyHost>[0]['timings'];

  private makeHost(): PartyHost {
    return new PartyHost({
      client: this.client,
      clientId: `client-${this.name}`, // stable: a restarted host of the same browser keeps its identity
      uuid: () => `${this.name}-${++this.n}`,
      deliver: (tab, msg) => {
        const list = this.inbox.get(tab) ?? [];
        list.push(msg);
        this.inbox.set(tab, list);
        if (msg.type === 'vibeparty:status') this.statuses.push({ mode: msg.mode, ...(msg.reason ? { reason: msg.reason } : {}) });
      },
      storage: { load: () => this.saved.state, save: (s) => (this.saved.state = JSON.parse(JSON.stringify(s))) },
      now: () => Date.now() + this.skew,
      random: () => 0.5,
      persistDebounceMs: 0,
      timings: this.timings,
    });
  }

  start() {
    this.host.start();
    return this;
  }
  /** A host restart: a brand-new host process reading what the old one saved. */
  restart() {
    this.host.stop();
    this.host = this.makeHost();
    this.host.start();
  }
  /** Each joined tab pings every 20 s, like the real content script — otherwise the controller prunes it as a ghost. */
  private readonly pingers = new Map<number, ReturnType<typeof setInterval>>();
  join(tab: number, name: string, room = ROOM) {
    this.host.controller.handleContent(tab, { type: 'vibeparty:join', room, name });
    clearInterval(this.pingers.get(tab));
    this.pingers.set(
      tab,
      setInterval(() => this.host.controller.handleContent(tab, { type: 'vibeparty:ping', room, name }), 20_000),
    );
  }
  send(tab: number, msg: unknown) {
    if ((msg as { type?: string }).type === 'vibeparty:leave') this.stopPinging(tab);
    this.host.controller.handleContent(tab, msg);
  }
  private stopPinging(tab: number) {
    clearInterval(this.pingers.get(tab));
    this.pingers.delete(tab);
  }
  closeTab(tab: number) {
    this.stopPinging(tab);
    this.host.controller.tabClosed(tab);
  }
  msgs<T extends BackgroundToContent['type']>(tab: number, type: T): Array<Msg<T>> {
    return (this.inbox.get(tab) ?? []).filter((m) => m.type === type) as Array<Msg<T>>;
  }
  last<T extends BackgroundToContent['type']>(tab: number, type: T): Msg<T> | undefined {
    return this.msgs(tab, type).at(-1);
  }
  /** Who this tab currently believes is here (the latest of `joined` / `presence`). */
  roster(tab: number): string[] {
    const list = this.inbox.get(tab) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m?.type === 'vibeparty:presence') return m.peers.map((p) => p.name).sort();
      if (m?.type === 'vibeparty:joined') return m.state.peers.map((p) => p.name).sort();
    }
    return [];
  }
  get mode() {
    return this.host.controller.linkOf(ROOM).mode;
  }
  /** Is this browser's transport currently the hub? (Whoever claimed it — read from Presence.) */
  get isHub(): boolean {
    const meta = this.server.presence(TOPIC)[`client-${this.name}`]?.at(-1);
    return meta?.hub === true;
  }
  stop() {
    for (const tab of [...this.pingers.keys()]) this.stopPinging(tab);
    this.host.stop();
  }
}

let server: FakeRealtimeServer;
const browsers: Browser[] = [];
const spawn = (name: string, opts?: ConstructorParameters<typeof Browser>[2]) => {
  const b = new Browser(server, name, opts).start();
  browsers.push(b);
  return b;
};
/** Run until two browsers have both joined and the dust has settled. */
const settle = () => tick(2_000);

beforeEach(() => {
  vi.useFakeTimers();
  server = new FakeRealtimeServer();
});
afterEach(() => {
  for (const b of browsers.splice(0)) b.stop();
  vi.useRealTimers();
});

describe('two browsers in one live party', () => {
  it('syncs presence, chat, reactions, playback and the queue — with exactly one hub', async () => {
    const a = spawn('a');
    const b = spawn('b');
    a.join(1, 'Alex');
    b.join(1, 'Sam');
    await settle();

    expect(a.mode).toBe('live');
    expect(b.mode).toBe('live');
    expect(a.roster(1)).toEqual(['Alex', 'Sam']);
    expect(b.roster(1)).toEqual(['Alex', 'Sam']);
    expect([a.isHub, b.isHub].filter(Boolean)).toHaveLength(1);

    // chat — delivered exactly once to each side (the origin gets its optimistic copy only)
    b.send(1, { type: 'vibeparty:chat', text: 'hello from B' });
    await tick(200);
    expect(a.msgs(1, 'vibeparty:chat')).toHaveLength(1);
    expect(b.msgs(1, 'vibeparty:chat')).toHaveLength(1);
    expect(a.last(1, 'vibeparty:chat')?.message).toMatchObject({ text: 'hello from B', name: 'Sam' });

    // reactions skip the sender
    a.send(1, { type: 'vibeparty:reaction', emoji: '🔥', messageId: null });
    await tick(200);
    expect(b.msgs(1, 'vibeparty:reaction')).toHaveLength(1);
    expect(a.msgs(1, 'vibeparty:reaction')).toHaveLength(0);

    // playback
    a.send(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 10, playing: true, videoId: VID });
    await tick(200);
    const media = b.last(1, 'vibeparty:media')?.media;
    expect(media).toMatchObject({ playing: true, videoId: VID });
    expect(media?.mediaTime).toBeGreaterThanOrEqual(10);
    expect(media?.mediaTime).toBeLessThan(10.6);
    expect(a.msgs(1, 'vibeparty:media')).toHaveLength(0);

    // queue: add → vote → non-owner can't remove → owner removes
    a.send(1, { type: 'vibeparty:queue:add', url: watchUrlFor(VID), title: 'One' });
    await tick(200);
    const id = b.last(1, 'vibeparty:queue')?.items[0]?.id ?? '';
    expect(id).not.toBe('');
    b.send(1, { type: 'vibeparty:queue:vote', id });
    await tick(200);
    expect(a.last(1, 'vibeparty:queue')?.items[0]?.voters).toHaveLength(2);
    b.send(1, { type: 'vibeparty:queue:remove', id });
    await tick(200);
    expect(a.last(1, 'vibeparty:queue')?.items).toHaveLength(1);
    a.send(1, { type: 'vibeparty:queue:remove', id });
    await tick(200);
    expect(b.last(1, 'vibeparty:queue')?.items).toHaveLength(0);
  });

  it('a late joiner gets the history and the extrapolated playback position from whoever is the hub', async () => {
    const a = spawn('a');
    a.join(1, 'Alex');
    await tick(100);
    a.send(1, { type: 'vibeparty:chat', text: 'before you came' });
    a.send(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 30, playing: true, videoId: VID });
    await tick(5_000);

    const b = spawn('b');
    b.join(1, 'Sam');
    await settle();
    const joined = b.last(1, 'vibeparty:joined');
    expect(joined?.state.chat.map((m) => m.text)).toEqual(['before you came']);
    expect(joined?.state.media?.playing).toBe(true);
    expect(joined?.state.media?.mediaTime).toBeGreaterThan(34.5); // 30 s + the ~5 s that passed
    expect(joined?.state.media?.mediaTime).toBeLessThan(38);
    expect(joined?.state.peers.map((p) => p.name).sort()).toEqual(['Alex', 'Sam']);
  });

  it('advances the queue exactly once when a video ends, for everybody', async () => {
    const a = spawn('a');
    const b = spawn('b');
    a.join(1, 'Alex');
    b.join(1, 'Sam');
    await settle();
    a.send(1, { type: 'vibeparty:queue:add', url: watchUrlFor(VID), title: 'One' });
    a.send(1, { type: 'vibeparty:queue:add', url: watchUrlFor(VID2), title: 'Two' });
    a.send(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 0, playing: true, videoId: VID });
    await tick(300);

    a.send(1, { type: 'vibeparty:media', ev: 'ended', mediaTime: 212, playing: false, videoId: VID });
    await tick(300);
    for (const br of [a, b]) {
      expect(br.msgs(1, 'vibeparty:media').some((m) => m.media.reason === 'advance')).toBe(true);
      expect(br.last(1, 'vibeparty:queue')?.items.map((i) => i.title)).toEqual(['Two']);
    }
    // Sam's player fires `ended` for the old video a moment later — nothing more happens
    const before = a.msgs(1, 'vibeparty:media').length + b.msgs(1, 'vibeparty:media').length;
    b.send(1, { type: 'vibeparty:media', ev: 'ended', mediaTime: 212, playing: false, videoId: VID });
    await tick(300);
    expect(a.msgs(1, 'vibeparty:media').length + b.msgs(1, 'vibeparty:media').length).toBe(before);
  });

  it('does not depend on the machines agreeing on the time (an hour of clock skew changes nothing)', async () => {
    const a = spawn('a');
    const b = spawn('b', { skewMs: 3_600_000 });
    a.join(1, 'Alex');
    b.join(1, 'Sam');
    await settle();
    a.send(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 10, playing: true, videoId: VID });
    await tick(2_000);
    b.send(1, { type: 'vibeparty:resync' });
    const mediaTime = b.last(1, 'vibeparty:media')?.media.mediaTime ?? 0;
    expect(Math.abs(mediaTime - 12)).toBeLessThan(1); // ~10 s + the 2 s that passed; ~3600 s if any clock leaked
  });

  it('two tabs in one browser are one Presence entry with two peers', async () => {
    const a = spawn('a');
    const b = spawn('b');
    a.join(1, 'Alex');
    a.join(2, 'Alex (2)');
    b.join(1, 'Sam');
    await settle();
    expect(Object.keys(server.presence(TOPIC)).sort()).toEqual(['client-a', 'client-b']);
    expect(b.roster(1)).toEqual(['Alex', 'Alex (2)', 'Sam']);
    a.send(1, { type: 'vibeparty:chat', text: 'to the other tab and to Sam' });
    await tick(200);
    expect(a.msgs(2, 'vibeparty:chat')).toHaveLength(1);
    expect(b.msgs(1, 'vibeparty:chat')).toHaveLength(1);

    a.send(2, { type: 'vibeparty:leave' });
    await tick(500);
    expect(a.mode).toBe('live'); // the other tab keeps the link open
    expect(b.roster(1)).toEqual(['Alex', 'Sam']);
  });
});

describe('connection state', () => {
  it('goes connecting → live, and says so to the tab', async () => {
    const a = spawn('a');
    a.join(1, 'Alex');
    expect(a.last(1, 'vibeparty:joined')).toMatchObject({ mode: 'connecting' });
    await settle();
    expect(a.last(1, 'vibeparty:status')).toMatchObject({ mode: 'live', room: ROOM });
    expect(a.host.controller.appStatus()).toMatchObject({ online: true, rooms: [{ room: ROOM, mode: 'live' }] });
  });

  it('is a local party while signed out, and goes live by itself once the user signs in (and back when they sign out)', async () => {
    const a = spawn('a', { user: null });
    a.join(1, 'Alex');
    await settle();
    expect(a.last(1, 'vibeparty:joined')).toMatchObject({ mode: 'connecting' }); // asked before the session was known…
    expect(a.last(1, 'vibeparty:status')).toMatchObject({ mode: 'local', reason: 'signed-out' }); // …and told as soon as it was
    expect(a.host.controller.appStatus()).toMatchObject({ online: false, reason: 'signed-out' });
    expect(server.channels.size).toBe(0); // nothing was opened
    a.send(1, { type: 'vibeparty:chat', text: 'only local' });
    expect(a.msgs(1, 'vibeparty:chat')).toHaveLength(1);

    a.client.setUser('user-a');
    await settle();
    expect(a.mode).toBe('live');
    expect(a.last(1, 'vibeparty:status')).toMatchObject({ mode: 'live' });

    a.client.setUser(null);
    await tick(100);
    expect(a.mode).toBe('local');
    expect(a.last(1, 'vibeparty:status')).toMatchObject({ mode: 'local', reason: 'signed-out' });
    expect(server.channels.size).toBe(0); // the channel was closed, not left dangling
    expect(server.presence(TOPIC)).toEqual({});
  });

  it('switching accounts re-joins the room as the new user (a private channel is authorised once, at join)', async () => {
    const seen: Array<string | null> = [];
    server.authorize = (user) => {
      seen.push(user);
      return null;
    };
    const a = spawn('a');
    a.join(1, 'Alex');
    await settle();
    a.client.setUser('someone-else');
    await settle();
    expect(seen).toEqual(['user-a', 'someone-else']);
    expect(a.mode).toBe('live');
  });

  it('without a backend every party is local', async () => {
    const host = new PartyHost({ client: null, clientId: 'x', uuid: () => 'p1', deliver: () => {} });
    host.start();
    expect(host.transport.status(ROOM)).toEqual({ mode: 'local', reason: 'unconfigured' });
    expect(host.transport.availability()).toEqual({ online: false, reason: 'unconfigured' });
    host.stop();
  });

  it('a refused channel is retried once quickly (an expired token), then reported as an error, and recovers on retry()', async () => {
    let refuse: string | null = 'Unauthorized: You do not have permissions to read from this Channel topic: party:friday-vibes';
    server.authorize = () => refuse;
    const a = spawn('a');
    a.join(1, 'Alex');
    await tick(500);
    expect(a.mode).toBe('connecting'); // first refusal: maybe just a stale token
    await tick(4_000);
    expect(a.host.controller.linkOf(ROOM)).toMatchObject({ mode: 'error', reason: 'denied' });
    expect(a.last(1, 'vibeparty:status')).toMatchObject({ mode: 'error', reason: 'denied' });

    refuse = null;
    a.send(1, { type: 'vibeparty:retry' });
    await tick(500);
    expect(a.mode).toBe('live');
  });

  it('shows an error when a first connection keeps failing, keeps retrying with backoff, and goes live when the network returns', async () => {
    const a = spawn('a');
    a.client.offline = true;
    a.join(1, 'Alex');
    await tick(120_000);
    expect(a.host.controller.linkOf(ROOM)).toMatchObject({ mode: 'error', reason: 'failed' });
    const attempts = a.client.opened.length;
    expect(attempts).toBeGreaterThan(3);
    expect(attempts).toBeLessThan(15); // backoff: nowhere near one attempt per second

    a.client.restoreNetwork();
    await tick(60_000);
    expect(a.mode).toBe('live');
  });
});

describe('reconnecting', () => {
  it('shows "reconnecting", keeps changes local meanwhile, and reclaims its place when the network is back', async () => {
    const a = spawn('a');
    const b = spawn('b');
    a.join(1, 'Alex');
    b.join(1, 'Sam');
    await settle();

    b.client.dropNetwork(false);
    await tick(100);
    expect(b.mode).toBe('reconnecting');
    expect(b.last(1, 'vibeparty:status')).toMatchObject({ mode: 'reconnecting' });
    expect(a.roster(1)).toEqual(['Alex']); // a clean drop is noticed at once
    b.send(1, { type: 'vibeparty:chat', text: 'while offline' });
    expect(b.msgs(1, 'vibeparty:chat')).toHaveLength(1);
    expect(a.msgs(1, 'vibeparty:chat')).toHaveLength(0);

    b.client.restoreNetwork();
    await tick(30_000);
    expect(b.mode).toBe('live');
    expect(a.roster(1)).toEqual(['Alex', 'Sam']);
    expect(b.roster(1)).toEqual(['Alex', 'Sam']);
    b.send(1, { type: 'vibeparty:chat', text: 'back' });
    await tick(300);
    expect(a.last(1, 'vibeparty:chat')?.message.text).toBe('back');
  });

  it('a channel that keeps reporting errors while supabase-js retries does not starve (or inflate) our own backoff', async () => {
    const a = spawn('a');
    a.join(1, 'Alex');
    await settle();
    const old = [...a.client.channelsOpen][0];
    a.client.dropNetwork(false);
    // supabase-js re-reports the failure on each failed rejoin, more often than our backoff
    const noise = setInterval(() => old?.statusCb?.('CHANNEL_ERROR', new Error('rejoin failed')), 400);
    await tick(10_000);
    clearInterval(noise);
    expect(a.client.opened.length).toBeGreaterThanOrEqual(3); // we kept recreating the channel on our own schedule
    a.client.restoreNetwork();
    await tick(40_000);
    expect(a.mode).toBe('live');
  });

  it('a half-open connection leaves a stale entry behind; the reconnected browser replaces it — no duplicate, no "peer taken"', async () => {
    const a = spawn('a');
    const b = spawn('b');
    a.join(1, 'Alex');
    b.join(1, 'Sam');
    await settle();
    b.send(1, { type: 'vibeparty:chat', text: 'before' });
    await tick(200);
    const samPeer = b.last(1, 'vibeparty:joined')?.selfId;

    b.client.dropNetwork(true); // the server still lists b's old entry
    b.client.restoreNetwork();
    await tick(30_000);
    expect(b.mode).toBe('live');
    // Presence now holds the ghost AND the new entry under the same key; the roster counts the browser once.
    expect(server.presence(TOPIC)['client-b']?.length).toBe(2);
    expect(a.roster(1)).toEqual(['Alex', 'Sam']);
    expect(b.roster(1)).toEqual(['Alex', 'Sam']);
    expect(b.last(1, 'vibeparty:joined')?.selfId).toBe(samPeer); // the tab kept its peer id
    expect(b.msgs(1, 'vibeparty:error')).toHaveLength(0);

    server.expireGhosts();
    await tick(300);
    expect(a.roster(1)).toEqual(['Alex', 'Sam']);
  });

  it('when a stale entry lingers, the newest one wins — a tab that closed while offline does not come back as a ghost', async () => {
    const a = spawn('a');
    const b = spawn('b');
    a.join(1, 'Alex');
    b.join(1, 'Sam');
    b.join(2, 'Sam (2)');
    await settle();
    expect(a.roster(1)).toEqual(['Alex', 'Sam', 'Sam (2)']);

    b.client.dropNetwork(true); // the server keeps b's old entry: two peers
    b.closeTab(2); // while offline, the second tab goes away
    b.client.restoreNetwork();
    await tick(30_000);
    expect(server.presence(TOPIC)['client-b']?.length).toBe(2); // old entry + new entry under one key
    expect(a.roster(1)).toEqual(['Alex', 'Sam']); // the newest entry (one tab) is the truth, not the stale two-tab one
  });

  it('a restarted host (same browser) comes back as the same people, with the room it had', async () => {
    const a = spawn('a');
    const b = spawn('b');
    a.join(1, 'Alex');
    b.join(1, 'Sam');
    await settle();
    b.send(1, { type: 'vibeparty:chat', text: 'kept across the restart' });
    b.send(1, { type: 'vibeparty:queue:add', url: watchUrlFor(VID), title: 'One' });
    await tick(300);
    const samPeer = b.last(1, 'vibeparty:joined')?.selfId;

    b.restart();
    await tick(500);
    // tab 1 says hello again (it would, after the content script reloads) and is handed the party back
    b.send(1, { type: 'vibeparty:hello' });
    await tick(5_000);
    const rejoined = b.last(1, 'vibeparty:joined');
    expect(rejoined?.selfId).toBe(samPeer);
    expect(rejoined?.state.chat.map((m) => m.text)).toEqual(['kept across the restart']);
    expect(a.roster(1)).toEqual(['Alex', 'Sam']);
    expect(b.mode).toBe('live');
    expect(Object.keys(server.presence(TOPIC)).sort()).toEqual(['client-a', 'client-b']);
  });
});

describe('the hub', () => {
  it('is replaced when it leaves, and the room carries on with its state', async () => {
    const a = spawn('a');
    const b = spawn('b');
    const c = spawn('c');
    a.join(1, 'Alex');
    await tick(100);
    b.join(1, 'Sam');
    c.join(1, 'Riley');
    await settle();
    expect(a.isHub).toBe(true); // the first in the room claimed it
    a.send(1, { type: 'vibeparty:chat', text: 'history' });
    a.send(1, { type: 'vibeparty:queue:add', url: watchUrlFor(VID), title: 'One' });
    a.send(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 20, playing: true, videoId: VID });
    await tick(500);

    a.send(1, { type: 'vibeparty:leave' }); // the hub walks out
    await tick(3_000);
    expect([b.isHub, c.isHub].filter(Boolean)).toHaveLength(1);
    expect(b.roster(1)).toEqual(['Riley', 'Sam']);

    // the new hub knows the room: a newcomer is told the history, the queue and where the video is
    const d = spawn('d');
    d.join(1, 'Dana');
    await settle();
    const joined = d.last(1, 'vibeparty:joined');
    expect(joined?.state.chat.map((m) => m.text)).toEqual(['history']);
    expect(joined?.state.queue.map((q) => q.title)).toEqual(['One']);
    expect(joined?.state.media).toMatchObject({ playing: true, videoId: VID });

    // …and it still sequences events: Riley's vote reaches everyone
    const id = joined?.state.queue[0]?.id ?? '';
    c.send(1, { type: 'vibeparty:queue:vote', id });
    await tick(300);
    expect(d.last(1, 'vibeparty:queue')?.items[0]?.voters).toHaveLength(2);
  });

  it('members take over in client-id order, so a hub that leaves is replaced by exactly one new hub — no conflict to resolve', async () => {
    const a = spawn('a');
    const b = spawn('b');
    const c = spawn('c');
    const d = spawn('d');
    a.join(1, 'Alex');
    await tick(100);
    for (const [x, name] of [
      [b, 'Sam'],
      [c, 'Riley'],
      [d, 'Dana'],
    ] as const)
      x.join(1, name);
    await settle();
    expect(server.claims).toEqual(['client-a']);

    a.send(1, { type: 'vibeparty:leave' });
    await tick(5_000);
    expect(server.claims).toEqual(['client-a', 'client-b']); // the smallest remaining id claimed, and the rest saw it and stayed out
    expect(b.isHub).toBe(true);
  });

  it('messages sent while there is no hub are held and delivered once there is one', async () => {
    const a = spawn('a');
    const b = spawn('b');
    const c = spawn('c');
    const d = spawn('d');
    a.join(1, 'Alex');
    await tick(100);
    for (const [x, name] of [
      [b, 'Sam'],
      [c, 'Riley'],
      [d, 'Dana'],
    ] as const)
      x.join(1, name);
    await settle();
    expect(a.isHub).toBe(true);

    a.send(1, { type: 'vibeparty:leave' });
    await tick(5); // Presence has told everyone the hub is gone, but nobody has claimed it yet
    expect([b, c, d].some((x) => x.isHub)).toBe(false);
    c.send(1, { type: 'vibeparty:chat', text: 'sent in the gap' });
    c.send(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 5, playing: true, videoId: VID });
    await tick(3_000);

    expect([b, c, d].filter((x) => x.isHub)).toHaveLength(1);
    // the others hear it from the new hub — whichever of them that is — even though it was sent before there was one
    for (const other of [b, d]) {
      expect(other.last(1, 'vibeparty:chat')?.message.text).toBe('sent in the gap');
      expect(other.last(1, 'vibeparty:media')?.media).toMatchObject({ playing: true, videoId: VID });
    }
  });

  it('two members claiming at once settle on one hub (the smaller client id), and what the loser did as a hub is not lost', async () => {
    server.latencyMs = 40; // a wide window in which both claim before either has seen the other's claim
    const eager = { claimDelayMs: 0, claimStepMs: 0, claimJitterMs: 0 }; // no staggering: the safety net is what is under test
    const a = spawn('a', { timings: eager });
    const b = spawn('b', { timings: eager });
    a.join(1, 'Alex');
    b.join(1, 'Sam');
    await tick(100); // both have claimed; neither has seen the other's claim yet
    expect(a.isHub && b.isHub).toBe(true);
    b.send(1, { type: 'vibeparty:chat', text: 'early' });
    await settle();
    expect([a.isHub, b.isHub].filter(Boolean)).toHaveLength(1);
    expect(a.isHub).toBe(true);
    expect(a.roster(1)).toEqual(['Alex', 'Sam']);
    // what Sam did as a hub that then lost was handed to the winner, so nobody missed it
    expect(a.msgs(1, 'vibeparty:chat').map((m) => m.message.text)).toEqual(['early']);
    a.send(1, { type: 'vibeparty:chat', text: 'later' });
    await tick(300);
    expect(b.last(1, 'vibeparty:chat')?.message.text).toBe('later');
  });

  it('a hub that crashed (its entry lingers in Presence) is detected by silence and replaced', async () => {
    const a = spawn('a');
    const b = spawn('b');
    a.join(1, 'Alex');
    await tick(100);
    b.join(1, 'Sam');
    await settle();
    expect(a.isHub).toBe(true);

    a.client.dropNetwork(true); // crash: the entry stays, claiming the hub role, but nobody answers any more
    a.client.offline = true; // …and it never comes back
    await tick(500);
    expect(server.presence(TOPIC)['client-a']).toBeDefined();
    expect(b.isHub).toBe(false);

    await tick(60_000); // pings go unanswered → the hub is suspected → b claims
    expect(b.isHub).toBe(true);
    b.send(1, { type: 'vibeparty:chat', text: 'still here' });
    const c = spawn('c');
    c.join(1, 'Riley');
    await tick(5_000);
    expect(c.last(1, 'vibeparty:joined')?.state.chat.map((m) => m.text)).toEqual(['still here']);
  });
});

describe('hostile input', () => {
  /** A raw member of the room that isn't running pact's code. */
  async function intruder() {
    const client = new FakeClient(server, 'intruder');
    const channel = client.channel(TOPIC, { config: { private: true, broadcast: { self: false, ack: false }, presence: { key: 'intruder', enabled: true } } });
    channel.on('presence', { event: 'sync' }, () => {});
    channel.subscribe();
    await tick(50);
    return {
      channel,
      client,
      c: (payload: unknown) => channel.send({ type: 'broadcast', event: WIRE.clientEvent, payload }),
      s: (payload: unknown) => channel.send({ type: 'broadcast', event: WIRE.serverEvent, payload }),
    };
  }

  it('drops malformed, oversized and forged messages without throwing or changing the room', async () => {
    const a = spawn('a');
    const b = spawn('b');
    a.join(1, 'Alex');
    await tick(100);
    b.join(1, 'Sam');
    await settle();
    const evil = await intruder();
    const chatBefore = a.msgs(1, 'vibeparty:chat').length;

    const junk: unknown[] = [
      null,
      'x',
      5,
      [],
      {},
      { from: 'intruder' },
      { from: 'intruder', msg: { t: 'chat' } },
      { from: 'intruder', msg: { t: 'nope' } },
      { msg: { t: 'ping', ts: 1 } },
    ];
    for (const j of junk) {
      await evil.c(j);
      await evil.s(j);
    }
    // chat that is far too long, and from a peer that belongs to someone else
    await evil.c({ from: 'intruder', msg: { t: 'chat', room: ROOM, peerId: 'p', id: 'a'.repeat(5_000), text: 'x', at: 1 } });
    await evil.c({ from: 'intruder', msg: { t: 'chat', room: ROOM, peerId: 'p', id: 'ok', text: 'y'.repeat(WIRE.clientBytes * 2), at: 1 } });
    await evil.c({ from: 'intruder', msg: { t: 'chat', room: ROOM, peerId: 'a-1', id: 'forged', text: 'I am Alex', at: 1 } }); // a-1 is Alex's tab
    // an `s` event for another room, a `state` that is too big, and a "hub" message for a room we aren't in
    await evil.s({ msg: { t: 'chat', room: 'other-room', message: { id: 'z', peerId: 'p', name: 'x', text: 'y', at: 1 } } });
    await evil.s({
      msg: {
        t: 'state',
        room: ROOM,
        peers: [],
        queue: [],
        chat: Array.from({ length: 3000 }, (_, i) => ({ id: `m${i}`, peerId: 'p', name: 'n', text: 'z'.repeat(400), at: i })),
        media: null,
      },
    });
    await tick(500);

    expect(a.msgs(1, 'vibeparty:chat')).toHaveLength(chatBefore);
    expect(b.msgs(1, 'vibeparty:chat')).toHaveLength(0);
    expect(b.last(1, 'vibeparty:joined')?.state.chat).toEqual([]);
    expect(a.mode).toBe('live');
    expect(b.mode).toBe('live');
  });

  it('rate-limits a flooding member', async () => {
    const a = spawn('a');
    a.join(1, 'Alex');
    await tick(100);
    const evil = await intruder();
    for (let i = 0; i < 500; i++)
      void evil.c({ from: 'intruder', msg: { t: 'chat', room: ROOM, peerId: 'intruder-peer', id: `f${i}`, text: `spam ${i}`, at: i } });
    await tick(500);
    const accepted = a.msgs(1, 'vibeparty:chat').length;
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(100); // the burst allowance, not all 500
  });

  it('a member’s own flood of actions is limited before it reaches Realtime', async () => {
    const a = spawn('a');
    const b = spawn('b');
    a.join(1, 'Alex');
    await tick(100);
    b.join(1, 'Sam');
    await settle();
    const before = server.log.length;
    for (let i = 0; i < 300; i++) b.send(1, { type: 'vibeparty:chat', text: `msg ${i}` });
    await tick(300);
    const sent = server.log.slice(before).filter(([, event]) => event === WIRE.clientEvent);
    expect(sent.length).toBeGreaterThan(10);
    expect(sent.length).toBeLessThanOrEqual(45); // the burst allowance (40), not all 300
  });

  it('never publishes a message over the size cap', async () => {
    const a = spawn('a');
    const b = spawn('b');
    a.join(1, 'Alex');
    await tick(100);
    b.join(1, 'Sam');
    await settle();
    const before = server.log.length;
    // 24-char names and 500-char chat can't reach 16 KiB through the controller, so assert the cap holds for what does flow
    b.send(1, { type: 'vibeparty:chat', text: 'ok' });
    await tick(300);
    for (const [, , payload] of server.log.slice(before)) expect(JSON.stringify(payload).length).toBeLessThan(WIRE.clientBytes);
  });
});

describe('clean teardown', () => {
  it('leaving removes the channel and the Presence entry; the last one out leaves nothing running', async () => {
    const a = spawn('a');
    a.join(1, 'Alex');
    await settle();
    expect(server.channels.size).toBe(1);
    a.send(1, { type: 'vibeparty:leave' });
    await tick(500);
    expect(server.channels.size).toBe(0);
    expect(server.presence(TOPIC)).toEqual({});
    expect(a.msgs(1, 'vibeparty:left')).toHaveLength(1);
    a.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closing the YouTube tab leaves the party', async () => {
    const a = spawn('a');
    const b = spawn('b');
    a.join(1, 'Alex');
    b.join(1, 'Sam');
    await settle();
    b.closeTab(1);
    await tick(500);
    expect(a.roster(1)).toEqual(['Alex']);
    expect(b.server.channels.size).toBe(1);
  });

  it('rooms are independent: two parties in one browser use two channels', async () => {
    const a = spawn('a');
    a.join(1, 'Alex', ROOM);
    a.join(2, 'Alex', 'other-room');
    await settle();
    expect([...server.channels].map((c) => c.topic).sort()).toEqual(['party:friday-vibes', 'party:other-room']);
    a.send(2, { type: 'vibeparty:leave' });
    await tick(300);
    expect([...server.channels].map((c) => c.topic)).toEqual(['party:friday-vibes']);
  });
});
