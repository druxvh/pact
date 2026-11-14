import { beforeEach, describe, expect, it } from 'vitest';
import { LIMITS, type QueueItem, watchUrlFor } from './protocol';
import { Room } from './room';

let t = 0;
const clock = () => t;
const advance = (ms: number) => {
  t += ms;
};
const VID = (n: number) => `video${String(n).padStart(6, '0')}`; // 11 chars

const item = (n: number, over: Partial<QueueItem> = {}): QueueItem => ({
  id: `q${n}`,
  videoId: VID(n),
  url: watchUrlFor(VID(n)),
  title: `Song ${n}`,
  addedBy: 'a',
  addedByName: 'A',
  voters: ['a'],
  createdAt: n,
  ...over,
});

let room: Room;
beforeEach(() => {
  t = 1_000_000;
  room = new Room('friday-vibes', clock);
});

describe('people', () => {
  it('adds, renames and removes peers, tracking when the room went empty', () => {
    expect(room.emptySince).toBe(t);
    expect(room.join('a', 'Alex')).toBe('joined');
    expect(room.emptySince).toBeNull();
    expect(room.join('a', 'Alexandra')).toBe('updated');
    expect(room.peers()).toEqual([{ id: 'a', name: 'Alexandra' }]);
    advance(5000);
    expect(room.leave('a')).toBe(true);
    expect(room.emptySince).toBe(t);
    expect(room.leave('a')).toBe(false);
  });

  it('enforces the room size cap but still lets existing peers rename', () => {
    for (let i = 0; i < LIMITS.peersPerRoom; i++) room.join(`p${i}`, `n${i}`);
    expect(room.join('overflow', 'x')).toBe('full');
    expect(room.join('p0', 'renamed')).toBe('updated');
    expect(room.size).toBe(LIMITS.peersPerRoom);
  });
});

describe('media clock', () => {
  it('extrapolates while playing and freezes while paused — on our own clock', () => {
    expect(room.snapshot()).toBeNull();
    room.applyMedia('a', 'play', 10, true, VID(1));
    advance(5000);
    expect(room.snapshot()).toMatchObject({ playing: true, mediaTime: 15, videoId: VID(1), controllerPeerId: 'a' });
    room.applyMedia('a', 'pause', 15, false, VID(1));
    advance(60_000);
    expect(room.snapshot()).toMatchObject({ playing: false, mediaTime: 15 });
  });

  it('a seek keeps the state the player reported', () => {
    room.applyMedia('a', 'seek', 100, true, VID(1));
    expect(room.snapshot()?.playing).toBe(true);
    room.applyMedia('a', 'seek', 200, false, VID(1));
    expect(room.snapshot()).toMatchObject({ playing: false, mediaTime: 200 });
  });

  it('adopts a remote snapshot back-dated by the network latency (never the sender clock)', () => {
    room.adoptSnapshot({ playing: true, mediaTime: 10, videoId: VID(1), controllerPeerId: 'x' }, 200);
    expect(room.snapshot()?.mediaTime).toBeCloseTo(10.2, 5);
    advance(1000);
    expect(room.snapshot()?.mediaTime).toBeCloseTo(11.2, 5);
    // absurd latency estimates are clamped
    room.adoptSnapshot({ playing: true, mediaTime: 10, videoId: VID(1), controllerPeerId: null }, 9_999_999);
    expect(room.snapshot()?.mediaTime).toBeCloseTo(15, 5);
    room.adoptSnapshot({ playing: true, mediaTime: 10, videoId: VID(1), controllerPeerId: null }, -50);
    expect(room.snapshot()?.mediaTime).toBeCloseTo(10, 5);
  });

  it('forgets the controller when they leave', () => {
    room.join('a', 'A');
    room.applyMedia('a', 'play', 0, true, VID(1));
    room.leave('a');
    expect(room.snapshot()?.controllerPeerId).toBeNull();
  });
});

describe('queue', () => {
  it('rejects the same video twice, enforces the cap, and sorts by votes then age', () => {
    expect(room.addQueue(item(1))).toBe('added');
    expect(room.addQueue(item(2))).toBe('added');
    expect(room.addQueue(item(99, { videoId: VID(1) }))).toBe('duplicate');
    expect(room.addQueue(item(1, { videoId: VID(50) }))).toBe('duplicate'); // same id

    expect(room.vote('q2', 'b')).toBe(true);
    expect(room.sortedQueue().map((q) => q.id)).toEqual(['q2', 'q1']); // 2 votes beats 1
    expect(room.vote('q2', 'b')).toBe(true); // toggle off
    expect(room.sortedQueue().map((q) => q.id)).toEqual(['q1', 'q2']); // tie → oldest first
    expect(room.vote('nope', 'b')).toBe(false);

    for (let i = 100; room.sortedQueue().length < LIMITS.queue; i++) room.addQueue(item(i));
    expect(room.addQueue(item(5000))).toBe('full');
  });

  it('only the owner can remove an item — unless the owner has left', () => {
    room.join('a', 'A');
    room.join('b', 'B');
    room.addQueue(item(1, { addedBy: 'a' }));
    expect(room.removeQueue('q1', 'b')).toBe(false);
    expect(room.removeQueue('q1', 'a')).toBe(true);

    room.addQueue(item(2, { addedBy: 'a' }));
    room.leave('a');
    expect(room.removeQueue('q2', 'b')).toBe(true); // orphaned item
    expect(room.removeQueue('q2', 'b')).toBe(false);
  });
});

describe('ended → advance', () => {
  it('plays the top-voted item next, removes the one that just finished, and is idempotent', () => {
    room.addQueue(item(1));
    room.addQueue(item(2));
    room.addQueue(item(3));
    room.vote('q3', 'b'); // q3 now leads
    room.applyMedia('a', 'play', 0, true, VID(1));

    const first = room.onEnded('a', VID(1), 200);
    expect(first.advanced).toBe(true);
    expect(first.queueChanged).toBe(true);
    expect(first.snapshot).toMatchObject({ playing: true, mediaTime: 0, videoId: VID(3), controllerPeerId: null, reason: 'advance' });
    expect(room.sortedQueue().map((q) => q.id)).toEqual(['q3', 'q2']); // q1 (just played) is gone

    // The other viewers' players fire `ended` a moment later — the room has already moved on.
    const dup = room.onEnded('b', VID(1), 200);
    expect(dup).toEqual({ advanced: false, queueChanged: false, snapshot: null });
    expect(room.snapshot()?.videoId).toBe(VID(3));
  });

  it('starts the queue when the video that ended was not from it', () => {
    room.addQueue(item(7));
    room.applyMedia('a', 'play', 0, true, VID(9));
    const r = room.onEnded('a', VID(9), 100);
    expect(r.advanced).toBe(true);
    expect(r.queueChanged).toBe(false);
    expect(r.snapshot?.videoId).toBe(VID(7));
  });

  it('with an empty queue it simply stops', () => {
    room.applyMedia('a', 'play', 0, true, VID(1));
    const r = room.onEnded('a', VID(1), 321);
    expect(r.advanced).toBe(false);
    expect(r.snapshot).toMatchObject({ playing: false, mediaTime: 321, videoId: VID(1) });
  });
});

describe('chat', () => {
  it('de-duplicates by id and keeps only the most recent messages', () => {
    const m = (n: number) => ({ id: `m${n}`, peerId: 'a', name: 'A', text: `hi ${n}`, at: n });
    expect(room.addChat(m(1))).toBe(true);
    expect(room.addChat(m(1))).toBe(false);
    for (let i = 2; i < LIMITS.chatHistory + 50; i++) room.addChat(m(i));
    const chat = room.chat();
    expect(chat).toHaveLength(LIMITS.chatHistory);
    expect(chat.at(-1)?.id).toBe(`m${LIMITS.chatHistory + 49}`);
  });
});

describe('serialisation', () => {
  it('round-trips a full room', () => {
    room.join('a', 'Alex');
    room.addQueue(item(1));
    room.addChat({ id: 'm1', peerId: 'a', name: 'Alex', text: 'yo', at: 1 });
    room.applyMedia('a', 'play', 42, true, VID(1));
    advance(1000);

    const copy = Room.fromJSON(JSON.parse(JSON.stringify(room)), clock);
    expect(copy?.state()).toEqual(room.state());
  });

  it('re-validates what it loads and rejects garbage', () => {
    expect(Room.fromJSON(null)).toBeNull();
    expect(Room.fromJSON({ id: 5 })).toBeNull();
    const r = Room.fromJSON(
      { id: 'abcd', peers: 'x', queue: [{ id: 'q', videoId: 'bad' }], chat: [null], anchor: { playing: 'no', mediaTime: 1, at: 1 } },
      clock,
    );
    expect(r?.state()).toMatchObject({ peers: [], queue: [], chat: [], media: null });
  });
});
