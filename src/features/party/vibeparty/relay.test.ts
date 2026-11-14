// @vitest-environment node
// Real WebSockets: two simulated browsers (each = the extension's PartyController + RelayClient) talk through a
// real relay on a random local port. This exercises the whole live-party path without Chrome.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket as WS } from 'ws';
import { type Relay, startRelay } from '../../../../server/relay';
import { PartyController } from './controller';
import { type BackgroundToContent, watchUrlFor } from './protocol';
import { RelayClient } from './relay-client';

const ROOM = 'friday-vibes';
const VID = 'dQw4w9WgXcQ';
const VID2 = 'jNQXAC9IVRw';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await sleep(10);
  }
}

type Msg<T extends BackgroundToContent['type']> = Extract<BackgroundToContent, { type: T }>;

/** One browser: its background controller, its relay socket, and the YouTube tabs it hosts. */
class Browser {
  readonly controller: PartyController;
  readonly client: RelayClient;
  private readonly inbox = new Map<number, BackgroundToContent[]>();

  constructor(url: string, readonly prefix: string, skewMs = 0) {
    let n = 0;
    const now = () => Date.now() + skewMs;
    const ref: { c?: PartyController } = {};
    this.client = new RelayClient(
      url,
      {
        onOpen: () => ref.c?.relayOpened(),
        onClose: () => ref.c?.relayClosed(),
        onMessage: (m) => ref.c?.relayMessage(m),
        onLatency: (ms) => ref.c?.setLatency(ms),
      },
      { now, baseDelayMs: 20, maxDelayMs: 100 },
    );
    this.controller = new PartyController({
      now,
      uuid: () => `${prefix}-${++n}`,
      send: (tab, msg) => {
        const list = this.inbox.get(tab) ?? [];
        list.push(msg);
        this.inbox.set(tab, list);
      },
      relay: this.client,
    });
    ref.c = this.controller;
  }

  start = () => this.client.start();
  stop = () => this.client.stop();
  get connected() {
    return this.client.connected;
  }
  msgs<T extends BackgroundToContent['type']>(tab: number, type: T): Array<Msg<T>> {
    return (this.inbox.get(tab) ?? []).filter((m) => m.type === type) as Array<Msg<T>>;
  }
  last<T extends BackgroundToContent['type']>(tab: number, type: T): Msg<T> | undefined {
    return this.msgs(tab, type).at(-1);
  }
  /**
   * Who this tab currently believes is in the room: the latest of `joined` / `presence`. (Which one tells a tab
   * about a newcomer depends on whose join the relay happens to process first — the overlay treats both alike.)
   */
  roster(tab: number): string[] {
    const list = this.inbox.get(tab) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m?.type === 'vibeparty:presence') return m.peers.map((p) => p.name).sort();
      if (m?.type === 'vibeparty:joined') return m.state.peers.map((p) => p.name).sort();
    }
    return [];
  }
  join(tab: number, name: string, room = ROOM) {
    this.controller.handleContent(tab, { type: 'vibeparty:join', room, name });
  }
  send(tab: number, msg: unknown) {
    this.controller.handleContent(tab, msg);
  }
}

let relay: Relay;
let url: string;
const browsers: Browser[] = [];
const raws: WS[] = [];

const newBrowser = (prefix: string, skewMs = 0) => {
  const b = new Browser(url, prefix, skewMs);
  browsers.push(b);
  b.start();
  return b;
};

beforeEach(async () => {
  relay = await startRelay({ port: 0, heartbeatMs: 60_000 });
  url = `ws://127.0.0.1:${relay.port}`;
});

afterEach(async () => {
  for (const b of browsers.splice(0)) b.stop();
  for (const w of raws.splice(0)) w.terminate();
  await relay.close();
});

function raw(target = url, options?: ConstructorParameters<typeof WS>[2]) {
  const ws = new WS(target, options);
  raws.push(ws);
  const inbox: Array<Record<string, unknown>> = [];
  ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
  const open = new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
  return { ws, inbox, open, closed, send: (o: unknown) => ws.send(typeof o === 'string' ? o : JSON.stringify(o)) };
}

describe('two browsers in one live party', () => {
  it('syncs presence, chat, playback and the queue', async () => {
    const a = newBrowser('a');
    const b = newBrowser('b');
    await waitFor(() => a.connected && b.connected);

    a.join(1, 'Alex');
    b.join(1, 'Sam');
    await waitFor(() => a.roster(1).length === 2 && b.roster(1).length === 2);
    expect(a.last(1, 'vibeparty:joined')?.mode).toBe('live');
    expect(a.roster(1)).toEqual(['Alex', 'Sam']);
    expect(b.roster(1)).toEqual(['Alex', 'Sam']);

    // chat — delivered once to each side (the relay never echoes to the origin)
    a.send(1, { type: 'vibeparty:chat', text: 'hello from A' });
    await waitFor(() => b.msgs(1, 'vibeparty:chat').length === 1);
    await sleep(150);
    expect(a.msgs(1, 'vibeparty:chat')).toHaveLength(1);
    expect(b.msgs(1, 'vibeparty:chat')).toHaveLength(1);
    expect(b.last(1, 'vibeparty:chat')?.message).toMatchObject({ text: 'hello from A', name: 'Alex' });

    // reactions
    b.send(1, { type: 'vibeparty:reaction', emoji: '🔥', messageId: null });
    await waitFor(() => a.msgs(1, 'vibeparty:reaction').length === 1);
    expect(b.msgs(1, 'vibeparty:reaction')).toHaveLength(0);

    // playback
    const playedAt = Date.now();
    a.send(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 10, playing: true, videoId: VID });
    await waitFor(() => b.msgs(1, 'vibeparty:media').length === 1);
    const media = b.last(1, 'vibeparty:media')?.media;
    expect(media).toMatchObject({ playing: true, videoId: VID });
    expect(media?.mediaTime).toBeGreaterThanOrEqual(10);
    expect(media?.mediaTime).toBeLessThan(10 + (Date.now() - playedAt) / 1000 + 1); // "about 10", however slow the machine is
    expect(a.msgs(1, 'vibeparty:media')).toHaveLength(0);

    // queue: add → vote → non-owner can't remove → owner removes
    a.send(1, { type: 'vibeparty:queue:add', url: watchUrlFor(VID), title: 'One' });
    await waitFor(() => b.last(1, 'vibeparty:queue')?.items.length === 1);
    const id = b.last(1, 'vibeparty:queue')?.items[0]?.id ?? '';
    b.send(1, { type: 'vibeparty:queue:vote', id });
    await waitFor(() => a.last(1, 'vibeparty:queue')?.items[0]?.voters.length === 2);
    b.send(1, { type: 'vibeparty:queue:remove', id });
    await sleep(150);
    expect(a.last(1, 'vibeparty:queue')?.items).toHaveLength(1);
    a.send(1, { type: 'vibeparty:queue:remove', id });
    await waitFor(() => b.last(1, 'vibeparty:queue')?.items.length === 0);
  });

  it('a tab that joins late sees the history and the extrapolated playback position', async () => {
    const a = newBrowser('a');
    const b = newBrowser('b');
    await waitFor(() => a.connected && b.connected);
    a.join(1, 'Alex');
    a.send(1, { type: 'vibeparty:chat', text: 'before you came' });
    const playedAt = Date.now();
    a.send(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 30, playing: true, videoId: VID });
    await sleep(300);

    b.join(1, 'Sam');
    await waitFor(() => b.msgs(1, 'vibeparty:joined').length >= 1);
    // state arrives from the relay and replaces the local copy
    await waitFor(() => (b.last(1, 'vibeparty:joined')?.state.chat.length ?? 0) === 1);
    const joined = b.last(1, 'vibeparty:joined');
    expect(joined?.state.chat[0]?.text).toBe('before you came');
    expect(joined?.state.media?.playing).toBe(true);
    // the room's clock kept running while B was away: about 30 s + however long we really waited
    const elapsed = (Date.now() - playedAt) / 1000;
    expect(joined?.state.media?.mediaTime).toBeGreaterThan(30.2);
    expect(joined?.state.media?.mediaTime).toBeLessThan(30 + elapsed + 0.5);
  });

  it('advances the queue exactly once when a video ends, for everybody', async () => {
    const a = newBrowser('a');
    const b = newBrowser('b');
    await waitFor(() => a.connected && b.connected);
    a.join(1, 'Alex');
    b.join(1, 'Sam');
    await waitFor(() => a.roster(1).length === 2 && b.roster(1).length === 2);

    a.send(1, { type: 'vibeparty:queue:add', url: watchUrlFor(VID), title: 'One' });
    a.send(1, { type: 'vibeparty:queue:add', url: watchUrlFor(VID2), title: 'Two' });
    await waitFor(() => b.last(1, 'vibeparty:queue')?.items.length === 2);
    a.send(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 0, playing: true, videoId: VID });
    await waitFor(() => b.msgs(1, 'vibeparty:media').length === 1);

    a.send(1, { type: 'vibeparty:media', ev: 'ended', mediaTime: 212, playing: false, videoId: VID });
    for (const br of [a, b]) {
      await waitFor(() => br.msgs(1, 'vibeparty:media').some((m) => m.media.reason === 'advance'));
      await waitFor(() => br.last(1, 'vibeparty:queue')?.items.map((i) => i.title).join() === 'Two');
    }
    expect(b.msgs(1, 'vibeparty:media').at(-1)?.media).toMatchObject({ videoId: VID2, playing: true, reason: 'advance' });

    // Sam's player fires `ended` for the old video a moment later — nothing more happens
    const before = a.msgs(1, 'vibeparty:media').length + b.msgs(1, 'vibeparty:media').length;
    b.send(1, { type: 'vibeparty:media', ev: 'ended', mediaTime: 212, playing: false, videoId: VID });
    await sleep(200);
    expect(a.msgs(1, 'vibeparty:media').length + b.msgs(1, 'vibeparty:media').length).toBe(before);
  });

  it('removes a browser’s peers when its connection drops', async () => {
    const a = newBrowser('a');
    const b = newBrowser('b');
    await waitFor(() => a.connected && b.connected);
    a.join(1, 'Alex');
    b.join(1, 'Sam');
    await waitFor(() => a.roster(1).length === 2 && b.roster(1).length === 2);
    a.stop();
    await waitFor(() => b.roster(1).length === 1);
    expect(b.roster(1)).toEqual(['Sam']);
    expect(relay.stats().peers).toBe(1);
  });

  it('does not depend on the two machines agreeing on the time (an hour of clock skew changes nothing)', async () => {
    const a = newBrowser('a');
    const b = newBrowser('b', 3_600_000);
    await waitFor(() => a.connected && b.connected);
    a.join(1, 'Alex');
    b.join(1, 'Sam');
    await waitFor(() => a.roster(1).length === 2 && b.roster(1).length === 2);

    const playedAt = Date.now();
    a.send(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 10, playing: true, videoId: VID });
    await waitFor(() => b.msgs(1, 'vibeparty:media').length === 1);
    await sleep(400);
    b.send(1, { type: 'vibeparty:resync' });
    const elapsed = (Date.now() - playedAt) / 1000;
    const mediaTime = b.last(1, 'vibeparty:media')?.media.mediaTime ?? 0;
    // B's clock is an hour ahead; if any clock value leaked across, this would be ~3600 s off.
    expect(Math.abs(mediaTime - (10 + elapsed))).toBeLessThan(1);
    expect(mediaTime).toBeGreaterThan(10.3);
  });

  it('reconnects after the relay restarts and re-announces everyone', async () => {
    const a = newBrowser('a');
    const b = newBrowser('b');
    await waitFor(() => a.connected && b.connected);
    a.join(1, 'Alex');
    b.join(1, 'Sam');
    await waitFor(() => a.roster(1).length === 2 && b.roster(1).length === 2);

    const port = relay.port;
    await relay.close();
    await waitFor(() => !a.connected && !b.connected);
    expect(a.last(1, 'vibeparty:status')).toMatchObject({ mode: 'reconnecting' });

    relay = await startRelay({ port, heartbeatMs: 60_000 });
    await waitFor(() => a.connected && b.connected, 5000);
    await waitFor(() => a.last(1, 'vibeparty:status')?.mode === 'live');
    await waitFor(() => relay.stats().peers === 2);

    a.send(1, { type: 'vibeparty:chat', text: 'we are back' });
    await waitFor(() => b.msgs(1, 'vibeparty:chat').some((m) => m.message.text === 'we are back'));
  }, 15_000);
});

describe('relay hardening', () => {
  const join = (peerId: string, name = 'x') => ({ t: 'join', room: ROOM, peerId, name });

  it('ignores garbage frames and keeps serving', async () => {
    const r = raw();
    await r.open;
    for (const junk of ['not json', '{"t":"nope"}', '[]', 'null', '{"t":"join"}', JSON.stringify({ t: 'chat', room: ROOM, peerId: 'ghost', id: 'i', text: 'hi', at: 1 })]) r.send(junk);
    r.send({ t: 'ping', ts: 42 });
    await waitFor(() => r.inbox.some((m) => m.t === 'pong'));
    expect(r.inbox.find((m) => m.t === 'pong')).toEqual({ t: 'pong', ts: 42 });
  });

  it('one socket cannot speak for, or steal, another socket’s peer', async () => {
    const victim = raw();
    const attacker = raw();
    await Promise.all([victim.open, attacker.open]);
    victim.send(join('victim-1', 'Vic'));
    attacker.send(join('attacker-1', 'Eve'));
    await waitFor(() => victim.inbox.some((m) => m.t === 'state') && attacker.inbox.some((m) => m.t === 'state'));

    attacker.send({ t: 'chat', room: ROOM, peerId: 'victim-1', id: 'forged', text: 'I am Vic', at: 1 }); // speaking as Vic
    attacker.send(join('victim-1', 'Eve')); // trying to take Vic's id
    await waitFor(() => attacker.inbox.some((m) => m.t === 'error' && m.code === 'peer_taken'));
    await sleep(100);
    expect(victim.inbox.some((m) => m.t === 'chat')).toBe(false);

    attacker.send({ t: 'chat', room: ROOM, peerId: 'attacker-1', id: 'legit', text: 'hi', at: 1 });
    await waitFor(() => victim.inbox.some((m) => m.t === 'chat'));
    expect((victim.inbox.find((m) => m.t === 'chat')?.message as { name: string }).name).toBe('Eve'); // the relay, not the client, supplies the name
  });

  it('cannot post into a room it has not joined', async () => {
    const a = raw();
    const b = raw();
    await Promise.all([a.open, b.open]);
    a.send(join('a-1'));
    b.send({ t: 'join', room: 'another-room', peerId: 'b-1', name: 'b' });
    await waitFor(() => a.inbox.some((m) => m.t === 'state') && b.inbox.some((m) => m.t === 'state'));
    b.send({ t: 'chat', room: ROOM, peerId: 'b-1', id: 'x', text: 'wrong room', at: 1 });
    await sleep(100);
    expect(a.inbox.some((m) => m.t === 'chat')).toBe(false);
  });

  it('closes connections that send oversized frames', async () => {
    const r = raw();
    await r.open;
    r.send(JSON.stringify({ t: 'chat', room: ROOM, peerId: 'p', id: 'i', text: 'x'.repeat(20_000), at: 1 }));
    expect(await r.closed).toBe(1009);
  });

  it('rate-limits floods and disconnects persistent offenders, without affecting others', async () => {
    const flooder = raw();
    const bystander = raw();
    await Promise.all([flooder.open, bystander.open]);
    for (let i = 0; i < 400; i++) flooder.send({ t: 'ping', ts: i });
    expect(await flooder.closed).toBe(1008);
    expect(flooder.inbox.filter((m) => m.t === 'pong').length).toBeLessThan(120); // most of the flood was dropped
    bystander.send({ t: 'ping', ts: 1 });
    await waitFor(() => bystander.inbox.some((m) => m.t === 'pong'));
  });

  it('enforces the room size and room count caps', async () => {
    await relay.close();
    relay = await startRelay({ port: 0, maxRooms: 2, heartbeatMs: 60_000 });
    const target = `ws://127.0.0.1:${relay.port}`;
    const r = raw(target);
    await r.open;
    r.send({ t: 'join', room: 'room-one', peerId: 'p-1', name: 'a' });
    r.send({ t: 'join', room: 'room-two', peerId: 'p-2', name: 'b' });
    r.send({ t: 'join', room: 'room-three', peerId: 'p-3', name: 'c' });
    await waitFor(() => r.inbox.some((m) => m.t === 'error' && m.code === 'server_full'));
    expect(relay.stats().rooms).toBe(2);
  });

  it('can be locked to your extension’s origin', async () => {
    await relay.close();
    relay = await startRelay({ port: 0, allowedOrigins: ['chrome-extension://good'], heartbeatMs: 60_000 });
    const target = `ws://127.0.0.1:${relay.port}`;
    const ok = raw(target, { origin: 'chrome-extension://good' });
    await ok.open;
    const bad = raw(target, { origin: 'https://evil.example' });
    await expect(bad.open).rejects.toThrow(/401|Unexpected server response/);
    const none = raw(target);
    await expect(none.open).rejects.toThrow();
  });
});
