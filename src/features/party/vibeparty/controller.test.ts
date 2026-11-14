import { describe, expect, it } from 'vitest';
import { PENDING_TTL_MS, PartyController, STALE_MEMBER_MS } from './controller';
import { type BackgroundToContent, type ClientMessage, type ServerMessage, watchUrlFor } from './protocol';

const ROOM = 'friday-vibes';
const VID = 'dQw4w9WgXcQ';
const VID2 = 'jNQXAC9IVRw';

type Msg<T extends BackgroundToContent['type']> = Extract<BackgroundToContent, { type: T }>;

class FakeRelay {
  connected = false;
  sent: ClientMessage[] = [];
  send(m: ClientMessage): boolean {
    if (!this.connected) return false;
    this.sent.push(m);
    return true;
  }
}

function setup(opts: { relay?: boolean } = {}) {
  let now = 1_000_000;
  let n = 0;
  const sent: Array<{ tabId: number; msg: BackgroundToContent }> = [];
  const relay = opts.relay ? new FakeRelay() : null;
  if (relay) relay.connected = true;
  let changes = 0;
  const c = new PartyController({
    now: () => now,
    uuid: () => `id-${++n}`,
    send: (tabId, msg) => sent.push({ tabId, msg }),
    relay,
    onChange: () => {
      changes++;
    },
  });
  /** Messages delivered to a tab, optionally filtered by type. */
  const to = <T extends BackgroundToContent['type']>(tabId: number, type: T): Array<Msg<T>> =>
    sent.filter((s) => s.tabId === tabId && s.msg.type === type).map((s) => s.msg as Msg<T>);
  return {
    c,
    relay,
    sent,
    to,
    advance: (ms: number) => {
      now += ms;
    },
    clear: () => {
      sent.length = 0;
      if (relay) relay.sent.length = 0;
    },
    changes: () => changes,
  };
}

const join = (c: PartyController, tab: number, name: string, room = ROOM) => c.handleContent(tab, { type: 'vibeparty:join', room, name });

describe('joining & presence', () => {
  it('puts a tab in the room and tells everyone who is there', () => {
    const { c, to } = setup();
    join(c, 1, 'Alex');
    const joined = to(1, 'vibeparty:joined')[0];
    expect(joined).toMatchObject({ selfId: 'id-1', mode: 'local', state: { room: ROOM, peers: [{ id: 'id-1', name: 'Alex' }] } });

    join(c, 2, 'Sam');
    expect(to(1, 'vibeparty:presence').at(-1)?.peers.map((p) => p.name)).toEqual(['Alex', 'Sam']);
    expect(to(2, 'vibeparty:joined')[0]?.state.peers).toHaveLength(2);
    expect(to(2, 'vibeparty:presence')).toHaveLength(0); // the joiner gets `joined`, not a redundant presence
  });

  it('is idempotent: joining the same room again keeps the peer id and just renames', () => {
    const { c, to } = setup();
    join(c, 1, 'Alex');
    join(c, 1, 'Alexandra');
    const joined = to(1, 'vibeparty:joined');
    expect(joined).toHaveLength(2);
    expect(joined[1]).toMatchObject({ selfId: 'id-1', state: { peers: [{ id: 'id-1', name: 'Alexandra' }] } });
  });

  it('moving to another room leaves the old one', () => {
    const { c, to } = setup();
    join(c, 1, 'Alex');
    join(c, 2, 'Sam');
    join(c, 1, 'Alex', 'other-room');
    expect(to(2, 'vibeparty:presence').at(-1)?.peers.map((p) => p.name)).toEqual(['Sam']);
    expect(c.appStatus().rooms.map((r) => r.room).sort()).toEqual(['friday-vibes', 'other-room']);
  });

  it('reports an invalid code and ignores hostile input without throwing', () => {
    const { c, sent, to } = setup();
    expect(c.joinTab(1, '!!', 'x')).toBe(false);
    expect(to(1, 'vibeparty:error')[0]?.message).toMatch(/isn’t valid/);
    sent.length = 0;
    for (const junk of [null, 'x', 5, [], {}, { type: 'vibeparty:media' }, { type: 'vibeparty:chat', text: 5 }]) expect(() => c.handleContent(1, junk)).not.toThrow();
    expect(sent).toHaveLength(0);
  });

  it('leaving tells the others, and the last one out removes the room', () => {
    const { c, to } = setup();
    join(c, 1, 'Alex');
    join(c, 2, 'Sam');
    c.handleContent(2, { type: 'vibeparty:leave' });
    expect(to(2, 'vibeparty:left')).toHaveLength(1);
    expect(to(1, 'vibeparty:presence').at(-1)?.peers.map((p) => p.name)).toEqual(['Alex']);
    c.tabClosed(1);
    expect(c.appStatus().rooms).toEqual([]);
  });

  it('heals after the worker lost its state (ping re-joins) and re-syncs after a page navigation (hello)', () => {
    const { c, to } = setup();
    c.handleContent(7, { type: 'vibeparty:ping', room: ROOM, name: 'Zed' });
    expect(to(7, 'vibeparty:joined')).toHaveLength(1);
    c.handleContent(7, { type: 'vibeparty:ping', room: ROOM, name: 'Zed' }); // already a member → no-op
    expect(to(7, 'vibeparty:joined')).toHaveLength(1);

    c.handleContent(7, { type: 'vibeparty:hello' }); // the page reloaded; fresh content script
    expect(to(7, 'vibeparty:joined')).toHaveLength(2);
    c.handleContent(99, { type: 'vibeparty:hello' }); // tab that was never in a party
    expect(to(99, 'vibeparty:joined')).toHaveLength(0);
  });

  it('joins a tab we opened for the party as soon as it says hello — but not if it took too long', () => {
    const { c, to, advance } = setup();
    expect(c.expectTab(5, 'Friday Vibes', 'Zed')).toBe(true);
    c.handleContent(5, { type: 'vibeparty:hello' });
    expect(to(5, 'vibeparty:joined')[0]).toMatchObject({ state: { room: ROOM, peers: [{ name: 'Zed' }] } });

    c.expectTab(6, ROOM, 'Late');
    advance(PENDING_TTL_MS + 1);
    c.handleContent(6, { type: 'vibeparty:hello' });
    expect(to(6, 'vibeparty:joined')).toHaveLength(0);
    expect(c.expectTab(8, '!', 'x')).toBe(false);
  });

  it('drops tabs that stopped pinging (navigated away, crashed) so they cannot haunt the room', () => {
    const { c, to, advance } = setup();
    join(c, 1, 'Alex');
    join(c, 2, 'Ghost');
    advance(STALE_MEMBER_MS - 1000);
    c.handleContent(1, { type: 'vibeparty:ping', room: ROOM, name: 'Alex' }); // Alex is alive, Ghost isn't
    advance(2000);
    c.prune();
    expect(to(1, 'vibeparty:presence').at(-1)?.peers.map((p) => p.name)).toEqual(['Alex']);
  });
});

describe('playback sync', () => {
  it('fans a player event out to the other tabs only, and late joiners get the extrapolated position', () => {
    const { c, to, advance } = setup();
    join(c, 1, 'Alex');
    join(c, 2, 'Sam');
    c.handleContent(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 10, playing: true, videoId: VID });
    expect(to(1, 'vibeparty:media')).toHaveLength(0);
    expect(to(2, 'vibeparty:media')[0]).toMatchObject({ from: 'id-1', media: { playing: true, mediaTime: 10, videoId: VID } });

    advance(4000);
    join(c, 3, 'Riley');
    const media = to(3, 'vibeparty:joined')[0]?.state.media;
    expect(media?.mediaTime).toBeCloseTo(14, 5);
    expect(media?.playing).toBe(true);
  });

  it('resync returns the current position on demand', () => {
    const { c, to, advance } = setup();
    join(c, 1, 'Alex');
    join(c, 2, 'Sam');
    c.handleContent(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 0, playing: true, videoId: VID });
    advance(3000);
    c.handleContent(2, { type: 'vibeparty:resync' });
    expect(to(2, 'vibeparty:media').at(-1)?.media.mediaTime).toBeCloseTo(3, 5);
  });

  it('keeps tabs in other rooms out of it', () => {
    const { c, to } = setup();
    join(c, 1, 'Alex');
    join(c, 2, 'Sam', 'other-room');
    c.handleContent(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 1, playing: true, videoId: VID });
    expect(to(2, 'vibeparty:media')).toHaveLength(0);
  });
});

describe('chat, reactions & queue', () => {
  it('chat reaches everyone including the sender; reactions skip the sender', () => {
    const { c, to } = setup();
    join(c, 1, 'Alex');
    join(c, 2, 'Sam');
    c.handleContent(1, { type: 'vibeparty:chat', text: 'hello  there' });
    expect(to(1, 'vibeparty:chat')[0]?.message).toMatchObject({ text: 'hello there', name: 'Alex', peerId: 'id-1' });
    expect(to(2, 'vibeparty:chat')).toHaveLength(1);

    c.handleContent(2, { type: 'vibeparty:reaction', emoji: '🔥', messageId: null });
    expect(to(2, 'vibeparty:reaction')).toHaveLength(0);
    expect(to(1, 'vibeparty:reaction')[0]?.reaction).toMatchObject({ emoji: '🔥', name: 'Sam' });
  });

  it('new joiners see the chat history', () => {
    const { c, to } = setup();
    join(c, 1, 'Alex');
    c.handleContent(1, { type: 'vibeparty:chat', text: 'first' });
    join(c, 2, 'Sam');
    expect(to(2, 'vibeparty:joined')[0]?.state.chat.map((m) => m.text)).toEqual(['first']);
  });

  it('queue: add, vote re-sorts for everyone, duplicates are refused, only owners remove', () => {
    const { c, to } = setup();
    join(c, 1, 'Alex');
    join(c, 2, 'Sam');
    c.handleContent(1, { type: 'vibeparty:queue:add', url: `https://youtu.be/${VID}`, title: 'One' });
    c.handleContent(2, { type: 'vibeparty:queue:add', url: watchUrlFor(VID2), title: 'Two' });
    const q = to(1, 'vibeparty:queue').at(-1)?.items ?? [];
    expect(q.map((i) => i.title)).toEqual(['One', 'Two']);
    expect(q[0]?.url).toBe(watchUrlFor(VID));

    const twoId = q[1]?.id ?? '';
    c.handleContent(1, { type: 'vibeparty:queue:vote', id: twoId });
    expect(to(2, 'vibeparty:queue').at(-1)?.items.map((i) => i.title)).toEqual(['Two', 'One']); // 2 votes now leads
    expect(to(2, 'vibeparty:queue').at(-1)?.items[0]?.voters).toEqual(['id-2', 'id-1']);

    c.handleContent(1, { type: 'vibeparty:queue:add', url: watchUrlFor(VID), title: 'Again' });
    expect(to(1, 'vibeparty:error').at(-1)?.message).toMatch(/already in the queue/);

    c.handleContent(1, { type: 'vibeparty:queue:remove', id: twoId }); // Sam's item
    expect(to(1, 'vibeparty:queue').at(-1)?.items).toHaveLength(2);
    c.handleContent(2, { type: 'vibeparty:queue:remove', id: twoId });
    expect(to(1, 'vibeparty:queue').at(-1)?.items.map((i) => i.title)).toEqual(['One']);
  });
});

describe('local mode: the queue advances when a video ends', () => {
  it('moves every tab (including the one that finished) to the next video, once', () => {
    const { c, to, clear } = setup();
    join(c, 1, 'Alex');
    join(c, 2, 'Sam');
    c.handleContent(1, { type: 'vibeparty:queue:add', url: watchUrlFor(VID), title: 'One' });
    c.handleContent(1, { type: 'vibeparty:queue:add', url: watchUrlFor(VID2), title: 'Two' });
    c.handleContent(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 0, playing: true, videoId: VID });
    clear();

    c.handleContent(1, { type: 'vibeparty:media', ev: 'ended', mediaTime: 212, playing: false, videoId: VID });
    for (const tab of [1, 2]) {
      expect(to(tab, 'vibeparty:media')[0]?.media).toMatchObject({ videoId: VID2, playing: true, reason: 'advance' });
      expect(to(tab, 'vibeparty:queue').at(-1)?.items.map((i) => i.title)).toEqual(['Two']);
    }

    clear();
    c.handleContent(2, { type: 'vibeparty:media', ev: 'ended', mediaTime: 212, playing: false, videoId: VID }); // Sam's player ends a moment later
    expect(to(1, 'vibeparty:media')).toHaveLength(0);
    expect(to(2, 'vibeparty:media')).toHaveLength(0);
    expect(to(1, 'vibeparty:queue')).toHaveLength(0);
  });
});

describe('live mode (relay connected)', () => {
  it('forwards your actions to the relay and applies them locally straight away', () => {
    const { c, relay, to } = setup({ relay: true });
    join(c, 1, 'Alex');
    expect(relay?.sent[0]).toEqual({ t: 'join', room: ROOM, peerId: 'id-1', name: 'Alex' });
    expect(to(1, 'vibeparty:joined')[0]?.mode).toBe('live');

    c.handleContent(1, { type: 'vibeparty:chat', text: 'hi' });
    expect(to(1, 'vibeparty:chat')).toHaveLength(1); // optimistic
    expect(relay?.sent.at(-1)).toMatchObject({ t: 'chat', room: ROOM, peerId: 'id-1', text: 'hi' });

    c.handleContent(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 5, playing: true, videoId: VID });
    expect(relay?.sent.at(-1)).toEqual({ t: 'media', room: ROOM, peerId: 'id-1', ev: 'play', mediaTime: 5, playing: true, videoId: VID });

    c.handleContent(1, { type: 'vibeparty:queue:add', url: watchUrlFor(VID), title: 'One' });
    expect(relay?.sent.at(-1)).toMatchObject({ t: 'queue:add', url: watchUrlFor(VID), title: 'One' });
  });

  it('lets the relay — not this browser — decide whether the queue advances', () => {
    const { c, relay, to, clear } = setup({ relay: true });
    join(c, 1, 'Alex');
    c.handleContent(1, { type: 'vibeparty:queue:add', url: watchUrlFor(VID2), title: 'Two' });
    c.handleContent(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 0, playing: true, videoId: VID });
    clear();

    c.handleContent(1, { type: 'vibeparty:media', ev: 'ended', mediaTime: 90, playing: false, videoId: VID });
    expect(relay?.sent).toEqual([{ t: 'media', room: ROOM, peerId: 'id-1', ev: 'ended', mediaTime: 90, playing: false, videoId: VID }]);
    expect(to(1, 'vibeparty:media')).toHaveLength(0); // no local advance
    expect(to(1, 'vibeparty:queue')).toHaveLength(0);

    // …the relay's verdict arrives and reaches every local tab, including the origin
    c.relayMessage({ t: 'queue', room: ROOM, items: [] });
    c.relayMessage({ t: 'media', room: ROOM, from: null, media: { playing: true, mediaTime: 0, videoId: VID2, controllerPeerId: null, reason: 'advance' } });
    expect(to(1, 'vibeparty:media')[0]?.media).toMatchObject({ videoId: VID2, reason: 'advance' });
    expect(to(1, 'vibeparty:queue')[0]?.items).toEqual([]);
  });

  it('ignores a duplicate `ended` for a video the room has already moved on from', () => {
    const { c, relay, to, clear } = setup({ relay: true });
    join(c, 1, 'Alex');
    c.relayMessage({ t: 'media', room: ROOM, from: null, media: { playing: true, mediaTime: 0, videoId: VID2, controllerPeerId: null, reason: 'advance' } });
    clear();
    c.handleContent(1, { type: 'vibeparty:media', ev: 'ended', mediaTime: 200, playing: false, videoId: VID }); // the old video's late echo
    expect(relay?.sent).toEqual([]);
    c.handleContent(1, { type: 'vibeparty:resync' });
    expect(to(1, 'vibeparty:media').at(-1)?.media).toMatchObject({ videoId: VID2, playing: true }); // our copy wasn't regressed
  });

  it('merges relay traffic without echoing your own actions back at you', () => {
    const { c, to } = setup({ relay: true });
    join(c, 1, 'Alex');
    join(c, 2, 'Sam');
    c.handleContent(1, { type: 'vibeparty:chat', text: 'mine' });
    const mine = to(1, 'vibeparty:chat')[0]?.message;
    expect(mine).toBeDefined();

    // the relay echoing our own message back is ignored (de-duplicated by id)…
    c.relayMessage({ t: 'chat', room: ROOM, message: mine as NonNullable<typeof mine> });
    expect(to(1, 'vibeparty:chat')).toHaveLength(1);
    // …a new message from someone else is delivered to both local tabs
    c.relayMessage({ t: 'chat', room: ROOM, message: { id: 'r1', peerId: 'remote-1', name: 'Remote', text: 'yo', at: 1 } });
    expect(to(1, 'vibeparty:chat')).toHaveLength(2);
    expect(to(2, 'vibeparty:chat')).toHaveLength(2);

    // a remote player event reaches both tabs; one that originated from a local peer skips that peer
    c.relayMessage({ t: 'media', room: ROOM, from: 'remote-1', media: { playing: true, mediaTime: 1, videoId: VID, controllerPeerId: 'remote-1' } });
    expect(to(1, 'vibeparty:media')).toHaveLength(1);
    expect(to(2, 'vibeparty:media')).toHaveLength(1);
    c.relayMessage({ t: 'media', room: ROOM, from: 'id-1', media: { playing: false, mediaTime: 2, videoId: VID, controllerPeerId: 'id-1' } });
    expect(to(1, 'vibeparty:media')).toHaveLength(1);
    expect(to(2, 'vibeparty:media')).toHaveLength(2);

    c.relayMessage({ t: 'reaction', room: ROOM, reaction: { id: 'x', peerId: 'id-2', name: 'Sam', emoji: '🎉', messageId: null, at: 1 } });
    expect(to(2, 'vibeparty:reaction')).toHaveLength(0);
    expect(to(1, 'vibeparty:reaction')).toHaveLength(1);

    c.relayMessage({ t: 'presence', room: ROOM, peers: [{ id: 'id-1', name: 'Alex' }, { id: 'remote-1', name: 'Remote' }] });
    expect(to(2, 'vibeparty:presence').at(-1)?.peers.map((p) => p.name)).toEqual(['Alex', 'Remote']);
  });

  it('a relay `state` replaces the room and re-sends `joined` to every local tab', () => {
    const { c, to } = setup({ relay: true });
    join(c, 1, 'Alex');
    const state: Extract<ServerMessage, { t: 'state' }> = {
      t: 'state',
      room: ROOM,
      peers: [{ id: 'id-1', name: 'Alex' }, { id: 'r', name: 'Remote' }],
      queue: [],
      chat: [{ id: 'old', peerId: 'r', name: 'Remote', text: 'earlier', at: 1 }],
      media: { playing: false, mediaTime: 33, videoId: VID, controllerPeerId: 'r' },
    };
    c.relayMessage(state);
    const joined = to(1, 'vibeparty:joined').at(-1);
    expect(joined?.state.chat.map((m) => m.text)).toEqual(['earlier']);
    expect(joined?.state.media).toMatchObject({ mediaTime: 33, playing: false });
    expect(joined?.state.peers).toHaveLength(2);
  });

  it('back-dates relay snapshots by the measured latency (clock-skew proof)', () => {
    const { c, to } = setup({ relay: true });
    join(c, 1, 'Alex');
    c.setLatency(300);
    c.relayMessage({ t: 'media', room: ROOM, from: 'remote', media: { playing: true, mediaTime: 50, videoId: VID, controllerPeerId: 'remote' } });
    expect(to(1, 'vibeparty:media')[0]?.media.mediaTime).toBeCloseTo(50.3, 5);
  });

  it('re-announces everyone when the relay reconnects, and reports the connection mode to the overlay', () => {
    const { c, relay, to, clear } = setup({ relay: true });
    join(c, 1, 'Alex');
    join(c, 2, 'Sam');
    clear();

    if (relay) relay.connected = false;
    c.relayClosed();
    expect(to(1, 'vibeparty:status')[0]).toMatchObject({ mode: 'reconnecting', room: ROOM });
    expect(c.appStatus().mode).toBe('reconnecting');

    // changes made while offline stay local…
    c.handleContent(1, { type: 'vibeparty:chat', text: 'offline' });
    expect(relay?.sent).toHaveLength(0);

    if (relay) relay.connected = true;
    c.relayOpened();
    expect(relay?.sent.filter((m) => m.t === 'join')).toEqual([
      { t: 'join', room: ROOM, peerId: 'id-1', name: 'Alex' },
      { t: 'join', room: ROOM, peerId: 'id-2', name: 'Sam' },
    ]);
    expect(to(2, 'vibeparty:status').at(-1)).toMatchObject({ mode: 'live' });
  });

  it('forwards the relay’s errors to the overlay', () => {
    const { c, to } = setup({ relay: true });
    join(c, 1, 'Alex');
    c.relayMessage({ t: 'error', code: 'room_full', message: 'This room is full.' });
    expect(to(1, 'vibeparty:error')[0]?.message).toBe('This room is full.');
  });
});

describe('surviving a service-worker restart', () => {
  it('restores tabs, peer ids and room state from storage.session', () => {
    const a = setup();
    join(a.c, 1, 'Alex');
    join(a.c, 2, 'Sam');
    a.c.handleContent(1, { type: 'vibeparty:chat', text: 'before the restart' });
    a.c.handleContent(1, { type: 'vibeparty:queue:add', url: watchUrlFor(VID), title: 'One' });
    a.c.handleContent(1, { type: 'vibeparty:media', ev: 'play', mediaTime: 20, playing: true, videoId: VID });
    const snapshot = JSON.parse(JSON.stringify(a.c.serialize()));

    const b = setup();
    b.advance(0);
    b.c.restore(snapshot);
    b.c.handleContent(2, { type: 'vibeparty:hello' });
    const joined = b.to(2, 'vibeparty:joined')[0];
    expect(joined?.selfId).toBe('id-2');
    expect(joined?.state.peers.map((p) => p.name)).toEqual(['Alex', 'Sam']);
    expect(joined?.state.chat.map((m) => m.text)).toEqual(['before the restart']);
    expect(joined?.state.queue.map((q) => q.title)).toEqual(['One']);
    expect(joined?.state.media).toMatchObject({ playing: true, videoId: VID });
  });

  it('drops members that went stale while the worker was asleep, and never throws on garbage', () => {
    const a = setup();
    join(a.c, 1, 'Alex');
    const snapshot = JSON.parse(JSON.stringify(a.c.serialize()));

    const b = setup();
    snapshot.members[0][1].lastSeen = 1_000_000 - STALE_MEMBER_MS * 3; // last heard from long before "now" (1_000_000)
    b.c.restore(snapshot);
    expect(b.c.appStatus().rooms).toEqual([]);

    for (const junk of [null, 'x', 5, [], { v: 2 }, { v: 1, rooms: 'x', members: 7 }, { v: 1, rooms: [null], members: [[1, null]], pending: [[2, 5]] }]) {
      expect(() => b.c.restore(junk)).not.toThrow();
    }
  });
});

describe('persistence hook', () => {
  it('flags state changes so the adapter can persist them', () => {
    const { c, changes } = setup();
    const before = changes();
    join(c, 1, 'Alex');
    c.handleContent(1, { type: 'vibeparty:chat', text: 'x' });
    expect(changes()).toBeGreaterThan(before);
  });
});
