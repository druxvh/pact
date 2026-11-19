import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isUserId, type NowPlayingApi, NowPlayingError } from './api';
import { MemoryNowPlayingServer } from './memoryApi';
import { createNowPlayingStore, MAX_WATCHED, type NowPlayingStore, TTL_MS } from './store';
import type { Track } from './track';

const track = (title: string, over: Partial<Track> = {}): Track => ({
  title,
  artist: 'Artist',
  album: '',
  artworkUrl: null,
  trackUrl: null,
  source: 'spotify',
  ...over,
});
const uid = () => crypto.randomUUID();
const settle = async (ms = 300) => {
  await vi.advanceTimersByTimeAsync(ms);
};

let server: MemoryNowPlayingServer;
let me: string;
let store: NowPlayingStore;
let api: NowPlayingApi;
let fetchSpy: ReturnType<typeof vi.fn>;
let subscribeSpy: ReturnType<typeof vi.fn>;
let visible = true;

beforeEach(() => {
  vi.useFakeTimers();
  server = new MemoryNowPlayingServer();
  me = uid();
  const inner = server.api(me);
  fetchSpy = vi.fn(inner.fetch);
  subscribeSpy = vi.fn(inner.subscribe);
  api = { ...inner, fetch: fetchSpy as never, subscribe: subscribeSpy as never };
  server.now = () => Date.now();
  visible = true;
  store = createNowPlayingStore(() => api, { now: () => Date.now(), visible: () => visible });
});
afterEach(() => {
  store.getState().reset();
  vi.useRealTimers();
});

describe('viewing other people', () => {
  it('fetches only the people being watched — never everyone — and subscribes to just them', async () => {
    const [a, b, c] = [uid(), uid(), uid()];
    server.set(a, track('A'));
    server.set(b, track('B'));
    server.set(c, track('C')); // on the server, but nobody is looking at them
    store.getState().watch(a);
    store.getState().watch(b);
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(new Set(fetchSpy.mock.calls[0]?.[0] as string[])).toEqual(new Set([a, b]));
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
    expect(new Set(subscribeSpy.mock.calls[0]?.[0] as string[])).toEqual(new Set([a, b]));
    expect(store.getState().rows[a]?.track.title).toBe('A');
    expect(store.getState().rows[b]?.track.title).toBe('B');
    expect(store.getState().rows[c]).toBeUndefined();
  });

  it('several components watching the same person make one lookup, and it stops when the last one goes', async () => {
    const a = uid();
    server.set(a, track('A'));
    const stop1 = store.getState().watch(a);
    const stop2 = store.getState().watch(a);
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    stop1();
    await settle();
    expect(subscribeSpy).toHaveBeenCalledTimes(1); // still watched by the second
    stop2();
    stop2(); // stopping twice is harmless
    await settle();
    expect(vi.getTimerCount()).toBe(0); // no poll, no sweep left running
  });

  it('adding someone later fetches just the newcomer and re-subscribes to everyone on screen', async () => {
    const [a, b] = [uid(), uid()];
    server.set(a, track('A'));
    server.set(b, track('B'));
    store.getState().watch(a);
    await settle();
    store.getState().watch(b);
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[0]).toEqual([b]);
    expect(new Set(subscribeSpy.mock.calls[1]?.[0] as string[])).toEqual(new Set([a, b]));
  });

  it('only account ids go to the network; at most 100 at a time', async () => {
    store.getState().watch('alex'); // a demo person: not an account
    store.getState().watch('local-user');
    store.getState().watch('');
    for (let i = 0; i < MAX_WATCHED + 20; i++) store.getState().watch(uid());
    await settle();
    const asked = fetchSpy.mock.calls.flatMap((c) => c[0] as string[]);
    expect(asked.every(isUserId)).toBe(true);
    expect(asked).toHaveLength(MAX_WATCHED);
  });

  it('people who aren’t listening, or whom you can’t see, simply have no row', async () => {
    const [a, b] = [uid(), uid()];
    server.set(a, track('A'), 'communities');
    server.shares = () => false; // not in a community together
    store.getState().watch(a);
    store.getState().watch(b);
    await settle();
    expect(store.getState().rows[a]).toBeUndefined();
    expect(store.getState().rows[b]).toBeUndefined();
  });

  it('live changes arrive over the subscription; a removal clears the row', async () => {
    const a = uid();
    store.getState().watch(a);
    await settle();
    expect(store.getState().rows[a]).toBeUndefined();
    server.set(a, track('Live'));
    expect(store.getState().rows[a]?.track.title).toBe('Live');
    server.set(a, track('Next'));
    expect(store.getState().rows[a]?.track.title).toBe('Next');
    server.clear(a);
    expect(store.getState().rows[a]).toBeUndefined();
  });

  it('events about people nobody is watching are ignored', async () => {
    const [a, other] = [uid(), uid()];
    store.getState().watch(a);
    await settle();
    const onEvent = subscribeSpy.mock.calls[0]?.[1] as (e: unknown) => void;
    onEvent({ type: 'upsert', userId: other, track: track('Stranger') });
    expect(store.getState().rows[other]).toBeUndefined();
  });
});

describe('"not listening" by age, without relying on a delete', () => {
  it('a row counts for 2 minutes after it arrived, and is then swept away', async () => {
    const a = uid();
    server.set(a, track('A'));
    store.getState().watch(a);
    await settle();
    expect(store.getState().rows[a]).toBeDefined();
    await settle(TTL_MS - 1000 - 300);
    expect(store.getState().rows[a]).toBeDefined();
    await settle(11_000); // the sweep runs every 10 s
    expect(store.getState().rows[a]).toBeUndefined();
  });

  it('a row that was already old when fetched expires sooner — by the SERVER’s age, not the viewer’s clock', async () => {
    const a = uid();
    server.set(a, track('A'), 'everyone', 100); // 100 s old
    store.getState().watch(a);
    await settle();
    const row = store.getState().rows[a];
    expect(row).toBeDefined();
    expect((row?.expiresAt ?? 0) - Date.now()).toBeLessThanOrEqual(20_000);
    await settle(31_000);
    expect(store.getState().rows[a]).toBeUndefined();
  });

  it('a row a heartbeat keeps refreshing stays', async () => {
    const a = uid();
    server.set(a, track('A'));
    store.getState().watch(a);
    for (let i = 0; i < 6; i++) {
      await settle(30_000);
      server.set(a, track('A')); // the heartbeat
    }
    expect(store.getState().rows[a]).toBeDefined();
  });

  it('a slow poll catches what Realtime missed (a stop whose delete never arrived)', async () => {
    const a = uid();
    server.set(a, track('A'));
    store.getState().watch(a);
    await settle();
    server.rows.delete(a); // removed without the subscription hearing about it
    await settle(46_000);
    expect(store.getState().rows[a]).toBeUndefined();
  });

  it('the poll rests while the page is hidden, and catches up when it is shown again', async () => {
    const a = uid();
    server.set(a, track('A'));
    store.getState().watch(a);
    await settle();
    const calls = fetchSpy.mock.calls.length;
    visible = false;
    await settle(120_000);
    expect(fetchSpy.mock.calls.length).toBe(calls);
    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle(10);
    expect(fetchSpy.mock.calls.length).toBe(calls + 1);
  });
});

describe('the simulated people', () => {
  it('demo friends are served locally, never fetched, and never expire', async () => {
    store.getState().watch('alex');
    await settle(10 * 60_000);
    expect(store.getState().rows.alex?.track.title).toBe('Midnight City');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(subscribeSpy).not.toHaveBeenCalled();
    expect(store.getState().rows.sam).toBeUndefined(); // not everyone is listening
  });
});

describe('when things go wrong', () => {
  it('a server without the feature yet: quiet, and not asked again for a while', async () => {
    server.available = false;
    const a = uid();
    store.getState().watch(a);
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await settle(46_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(store.getState().rows[a]).toBeUndefined();
    server.available = true;
    await settle(10 * 60_000);
    server.set(a, track('Back'));
    await settle(46_000); // the next poll
    expect(store.getState().rows[a]?.track.title).toBe('Back');
  });

  it('a dropped connection keeps what we know and tries again at the next poll', async () => {
    const a = uid();
    server.set(a, track('A'));
    store.getState().watch(a);
    await settle();
    fetchSpy.mockRejectedValueOnce(new NowPlayingError('network'));
    await settle(46_000);
    expect(store.getState().rows[a]?.track.title).toBe('A');
  });

  it('a guest has no API: nothing is fetched, nothing breaks', async () => {
    const guest = createNowPlayingStore(() => null, { visible: () => true });
    const stop = guest.getState().watch(uid());
    await settle();
    expect(guest.getState().rows).toEqual({});
    stop();
  });

  it('switching account forgets the previous one’s rows and an answer still on its way', async () => {
    const a = uid();
    server.set(a, track('A'));
    let release: (rows: Awaited<ReturnType<NowPlayingApi['fetch']>>) => void = () => {};
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    store.getState().watch(a);
    await settle();
    store.getState().reset(); // the account changed while the request was in flight
    release([{ userId: a, track: track('Old account'), ageSeconds: 0 }]);
    await settle(400);
    expect(store.getState().rows[a]?.track.title).not.toBe('Old account');
    // whoever is still on screen is looked up again, with the new account
    expect(store.getState().rows[a]?.track.title).toBe('A');
  });

  it('reset keeps the demo people', async () => {
    store.getState().watch('alex');
    store.getState().reset();
    expect(store.getState().rows.alex).toBeDefined();
  });
});
