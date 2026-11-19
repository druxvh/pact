import { describe, expect, it } from 'vitest';
import { RoomHub } from './hub';
import { type ChatMessage, type ClientMessage, type PeerInfo, WIRE, watchUrlFor } from './protocol';
import { jsonBytes } from './sanitize';

const ROOM = 'friday-vibes';
const VID = 'dQw4w9WgXcQ';
const VID2 = 'jNQXAC9IVRw';

function setup() {
  let now = 1_000_000;
  const hub = new RoomHub(ROOM, () => now);
  const people = (a: PeerInfo[], b: PeerInfo[] = []) => hub.setRoster([{ clientId: 'A', peers: a }, ...(b.length ? [{ clientId: 'B', peers: b }] : [])]);
  return { hub, people, advance: (ms: number) => (now += ms) };
}

const alex = { id: 'p-alex', name: 'Alex' };
const sam = { id: 'p-sam', name: 'Sam' };
const media = (peerId: string, over: Partial<Extract<ClientMessage, { t: 'media' }>> = {}): ClientMessage => ({
  t: 'media',
  room: ROOM,
  peerId,
  ev: 'play',
  mediaTime: 10,
  playing: true,
  videoId: VID,
  ...over,
});
const add = (peerId: string, id: string, videoId: string, title = 'Song'): ClientMessage => ({
  t: 'queue:add',
  room: ROOM,
  peerId,
  id,
  url: watchUrlFor(videoId),
  title,
});

describe('RoomHub', () => {
  it('answers a ping with a pong to the sender only', () => {
    const { hub } = setup();
    expect(hub.handle('A', { t: 'ping', ts: 42 })).toEqual([{ to: 'A', msg: { t: 'pong', ts: 42 } }]);
  });

  it('answers a join with the room’s state, addressed to the joiner', () => {
    const { hub, people } = setup();
    people([alex], [sam]);
    hub.handle('A', { t: 'chat', room: ROOM, peerId: alex.id, id: 'c1', text: 'hello', at: 1 });
    hub.handle('A', media(alex.id, { mediaTime: 30 }));
    const out = hub.handle('B', { t: 'join', room: ROOM, peerId: sam.id, name: 'Sam' });
    expect(out).toHaveLength(1);
    expect(out[0]?.to).toBe('B');
    expect(out[0]?.msg).toMatchObject({ t: 'state', room: ROOM, chat: [{ text: 'hello', name: 'Alex' }], media: { playing: true, videoId: VID } });
    expect(out[0]?.msg.t === 'state' && out[0].msg.peers.map((p) => p.name)).toEqual(['Alex', 'Sam']);
  });

  it('keeps the state under the wire budget by dropping the oldest chat first', () => {
    const { hub, people } = setup();
    people([alex]);
    const long = '😀'.repeat(400); // 4 bytes each in UTF-8: the worst case for the byte budget
    for (let i = 0; i < 200; i++) hub.handle('A', { t: 'chat', room: ROOM, peerId: alex.id, id: `m${i}`, text: `${i} ${long}`, at: i });
    const state = hub.state();
    expect(jsonBytes(state)).toBeLessThanOrEqual(WIRE.stateBytes);
    expect(state.chat.length).toBeGreaterThan(50);
    expect(state.chat.length).toBeLessThan(200);
    expect(state.chat.at(-1)?.id).toBe('m199'); // the newest survives
    expect(state.chat[0]?.id).not.toBe('m0');
  });

  describe('playback', () => {
    it('fans a player event out to everyone except its origin, and remembers it for late joiners', () => {
      const { hub, people, advance } = setup();
      people([alex], [sam]);
      const out = hub.handle('A', media(alex.id));
      expect(out).toEqual([
        { msg: { t: 'media', room: ROOM, from: alex.id, media: { playing: true, mediaTime: 10, videoId: VID, controllerPeerId: alex.id } }, except: 'A' },
      ]);
      advance(4000);
      expect(hub.state().media?.mediaTime).toBeCloseTo(14, 5);
    });

    it('advances the queue exactly once when a video ends, and tells everyone including the origin', () => {
      const { hub, people } = setup();
      people([alex], [sam]);
      hub.handle('A', add(alex.id, 'q1', VID, 'One'));
      hub.handle('A', add(alex.id, 'q2', VID2, 'Two'));
      hub.handle('A', media(alex.id, { mediaTime: 0 }));

      const out = hub.handle('A', media(alex.id, { ev: 'ended', mediaTime: 212, playing: false }));
      expect(out.map((o) => o.msg.t)).toEqual(['queue', 'media']);
      expect(out[0]?.msg).toMatchObject({ items: [{ title: 'Two' }] });
      expect(out[1]).toMatchObject({ msg: { media: { videoId: VID2, playing: true, reason: 'advance' }, from: null } });
      expect(out[1]?.except).toBeUndefined(); // the origin has to navigate too

      // Sam's player ends a moment later — the room already moved on
      expect(hub.handle('B', media(sam.id, { ev: 'ended', mediaTime: 212, playing: false }))).toEqual([]);
    });

    it('records "paused at the end" when nothing is queued, without telling the origin', () => {
      const { hub, people } = setup();
      people([alex]);
      hub.handle('A', media(alex.id));
      const out = hub.handle('A', media(alex.id, { ev: 'ended', mediaTime: 99, playing: false }));
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ except: 'A', msg: { t: 'media', from: alex.id, media: { playing: false, mediaTime: 99 } } });
    });
  });

  describe('chat & reactions', () => {
    it('names messages from the roster (not from the message), skips the origin, and de-duplicates by id', () => {
      const { hub, people } = setup();
      people([alex]);
      const msg: ClientMessage = { t: 'chat', room: ROOM, peerId: alex.id, id: 'c1', text: 'hi', at: 5 };
      const out = hub.handle('A', msg);
      expect(out).toEqual([
        { msg: { t: 'chat', room: ROOM, message: { id: 'c1', peerId: alex.id, name: 'Alex', text: 'hi', at: 1_000_000 } as ChatMessage }, except: 'A' },
      ]);
      expect(hub.handle('A', msg)).toEqual([]);
    });

    it('uses the name from `join` for a peer whose Presence entry hasn’t arrived yet, then switches to Presence’s', () => {
      const { hub, people } = setup();
      hub.handle('A', { t: 'join', room: ROOM, peerId: 'late', name: 'Late' });
      const first = hub.handle('A', { t: 'chat', room: ROOM, peerId: 'late', id: 'c1', text: 'hi', at: 1 });
      expect(first[0]?.msg).toMatchObject({ message: { name: 'Late' } });
      people([{ id: 'late', name: 'Later' }]);
      const second = hub.handle('A', { t: 'chat', room: ROOM, peerId: 'late', id: 'c2', text: 'again', at: 2 });
      expect(second[0]?.msg).toMatchObject({ message: { name: 'Later' } });
    });

    it('relays reactions to everyone but the origin', () => {
      const { hub, people } = setup();
      people([alex]);
      const out = hub.handle('A', { t: 'reaction', room: ROOM, peerId: alex.id, id: 'r1', emoji: '🔥', messageId: null });
      expect(out).toMatchObject([{ except: 'A', msg: { t: 'reaction', reaction: { emoji: '🔥', name: 'Alex' } } }]);
    });
  });

  describe('queue', () => {
    it('every change goes to everybody, origin included; duplicates still return the authoritative list', () => {
      const { hub, people } = setup();
      people([alex], [sam]);
      const a = hub.handle('A', add(alex.id, 'q1', VID, 'One'));
      expect(a).toMatchObject([{ msg: { t: 'queue', items: [{ title: 'One', voters: [alex.id], addedByName: 'Alex' }] } }]);
      expect(a[0]?.except).toBeUndefined();
      const dup = hub.handle('B', add(sam.id, 'q2', VID, 'Same video'));
      expect(dup[0]?.msg).toMatchObject({ items: [{ title: 'One' }] });

      const vote = hub.handle('B', { t: 'queue:vote', room: ROOM, peerId: sam.id, id: 'q1' });
      expect(vote[0]?.msg).toMatchObject({ items: [{ voters: [alex.id, sam.id] }] });
      expect(hub.handle('B', { t: 'queue:vote', room: ROOM, peerId: sam.id, id: 'nope' })).toEqual([]);
    });

    it('only the owner removes an item — unless the owner has left the room', () => {
      const { hub, people } = setup();
      people([alex], [sam]);
      hub.handle('A', add(alex.id, 'q1', VID, 'One'));
      expect(hub.handle('B', { t: 'queue:remove', room: ROOM, peerId: sam.id, id: 'q1' })).toEqual([]);
      people([], [sam]); // Alex's Presence entry disappeared
      const out = hub.handle('B', { t: 'queue:remove', room: ROOM, peerId: sam.id, id: 'q1' });
      expect(out[0]?.msg).toMatchObject({ t: 'queue', items: [] });
    });
  });

  describe('trust', () => {
    it('drops a message that speaks for a peer owned by another client, but not for a peer it has never heard of', () => {
      const { hub, people } = setup();
      people([alex], [sam]);
      // B pretends to be Alex
      expect(hub.handle('B', { t: 'chat', room: ROOM, peerId: alex.id, id: 'x', text: 'forged', at: 1 })).toEqual([]);
      expect(hub.handle('B', media(alex.id))).toEqual([]);
      expect(hub.handle('B', add(alex.id, 'q9', VID))).toEqual([]);
      expect(hub.state().chat).toEqual([]);
      expect(hub.state().media).toBeNull();
      // a brand-new peer (Presence hasn't caught up) is accepted
      expect(hub.handle('B', { t: 'chat', room: ROOM, peerId: 'new-peer', id: 'ok', text: 'hi', at: 1 })).toHaveLength(1);
    });

    it('a seeded hub continues the room instead of resetting it', () => {
      const { hub, people } = setup();
      hub.seed({
        peers: [alex],
        queue: [],
        chat: [{ id: 'old', peerId: alex.id, name: 'Alex', text: 'before the hub changed', at: 1 }],
        media: { playing: false, mediaTime: 77, videoId: VID, controllerPeerId: alex.id },
      });
      people([alex], [sam]);
      const state = hub.state();
      expect(state.chat.map((m) => m.text)).toEqual(['before the hub changed']);
      expect(state.media).toMatchObject({ mediaTime: 77, playing: false });
      expect(state.peers.map((p) => p.name)).toEqual(['Alex', 'Sam']); // the roster is Presence's, not the seed's
    });
  });
});
