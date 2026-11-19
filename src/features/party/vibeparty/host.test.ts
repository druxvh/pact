import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PartyHost } from './host';
import { stableClientId } from './host-page';
import type { BackgroundToContent, HostCommand } from './protocol';
import { VIBEPARTY_CLIENT_KEY } from './protocol';

const ROOM = 'friday-vibes';

function makeHost(opts: { saved?: unknown } = {}) {
  const delivered: Array<{ tabId: number; msg: BackgroundToContent }> = [];
  const saves: unknown[] = [];
  let n = 0;
  const host = new PartyHost({
    client: null, // no backend: everything local — enough to exercise the host's own job
    clientId: 'client-x',
    uuid: () => `peer-${++n}`,
    deliver: (tabId, msg) => delivered.push({ tabId, msg }),
    storage: { load: () => opts.saved, save: (s) => saves.push(JSON.parse(JSON.stringify(s))) },
    persistDebounceMs: 100,
    pruneMs: 1_000,
  });
  return { host, delivered, saves };
}

const cmd = (c: HostCommand) => c;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PartyHost commands', () => {
  it('routes the service worker’s commands to the controller and answers the ones that have an answer', () => {
    const { host, delivered } = makeHost();
    host.start();
    expect(host.handle(cmd({ type: 'vibeparty-host:ping' }))).toEqual({ ok: true });

    expect(host.handle(cmd({ type: 'vibeparty-host:join-tab', tabId: 4, room: ROOM, name: 'Alex' }))).toEqual({ ok: true });
    expect(delivered.find((d) => d.tabId === 4)?.msg).toMatchObject({ type: 'vibeparty:joined', mode: 'local', reason: 'unconfigured' });

    host.handle(cmd({ type: 'vibeparty-host:content', tabId: 4, message: { type: 'vibeparty:chat', text: 'hi' } }));
    expect(delivered.some((d) => d.msg.type === 'vibeparty:chat')).toBe(true);

    expect(host.handle(cmd({ type: 'vibeparty-host:status' }))).toMatchObject({
      hostRunning: true,
      online: false,
      reason: 'unconfigured',
      rooms: [{ room: ROOM, peers: 1 }],
    });

    host.handle(cmd({ type: 'vibeparty-host:tab-closed', tabId: 4 }));
    expect(host.controller.appStatus().rooms).toEqual([]);
    expect(host.controller.idle).toBe(true);
    host.stop();
  });

  it('a tab we expect joins when it says hello; the host is not idle meanwhile', () => {
    const { host, delivered } = makeHost();
    host.start();
    host.handle(cmd({ type: 'vibeparty-host:expect-tab', tabId: 9, room: ROOM, name: 'Zed' }));
    expect(host.controller.idle).toBe(false);
    host.handle(cmd({ type: 'vibeparty-host:content', tabId: 9, message: { type: 'vibeparty:hello' } }));
    expect(delivered.find((d) => d.tabId === 9)?.msg).toMatchObject({ type: 'vibeparty:joined', state: { room: ROOM } });
    host.stop();
  });

  it('prunes tabs that stopped pinging on its own timer', () => {
    const { host } = makeHost();
    host.start();
    host.handle(cmd({ type: 'vibeparty-host:join-tab', tabId: 1, room: ROOM, name: 'Ghost' }));
    vi.advanceTimersByTime(120_000);
    expect(host.controller.idle).toBe(true);
    host.stop();
  });
});

describe('PartyHost persistence', () => {
  it('saves its state shortly after a change (debounced), and a new host restores it with the same peer ids', () => {
    const a = makeHost();
    a.host.start();
    a.host.handle(cmd({ type: 'vibeparty-host:join-tab', tabId: 3, room: ROOM, name: 'Alex' }));
    a.host.handle(cmd({ type: 'vibeparty-host:content', tabId: 3, message: { type: 'vibeparty:chat', text: 'kept' } }));
    expect(a.saves).toHaveLength(0);
    vi.advanceTimersByTime(150);
    expect(a.saves).toHaveLength(1); // one write for the burst
    const saved = a.saves[0];
    a.host.stop();

    const b = makeHost({ saved });
    b.host.start();
    expect(b.host.controller.appStatus().rooms).toMatchObject([{ room: ROOM, peers: 1 }]);
    b.host.handle(cmd({ type: 'vibeparty-host:content', tabId: 3, message: { type: 'vibeparty:hello' } }));
    const joined = b.delivered.find((d) => d.tabId === 3 && d.msg.type === 'vibeparty:joined')?.msg;
    expect(joined).toMatchObject({ selfId: 'peer-1', state: { chat: [{ text: 'kept' }] } });
    b.host.stop();
  });

  it('survives garbage in storage and a storage that throws', () => {
    for (const saved of [null, 'x', 5, { v: 99 }, { v: 1, rooms: 'no' }]) {
      const { host } = makeHost({ saved });
      expect(() => host.start()).not.toThrow();
      host.stop();
    }
    const throwing = new PartyHost({
      client: null,
      clientId: 'c',
      uuid: () => 'p',
      deliver: () => {},
      storage: {
        load: () => {
          throw new Error('nope');
        },
        save: () => {
          throw new Error('full');
        },
      },
      persistDebounceMs: 10,
    });
    expect(() => throwing.start()).not.toThrow();
    throwing.handle(cmd({ type: 'vibeparty-host:join-tab', tabId: 1, room: ROOM, name: 'A' }));
    expect(() => vi.advanceTimersByTime(50)).not.toThrow();
    throwing.stop();
  });
});

describe('the browser’s identity in Presence', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
  };

  it('is created once and then stays the same across restarts', () => {
    const store = memory();
    const first = stableClientId(store);
    expect(first).toMatch(/^[\w-]{8,64}$/);
    expect(stableClientId(store)).toBe(first);
    expect(store.data.get(VIBEPARTY_CLIENT_KEY)).toBe(first);
  });

  it('replaces a stored value that isn’t a plausible id, and copes with storage that throws or is missing', () => {
    const store = memory();
    store.setItem(VIBEPARTY_CLIENT_KEY, '<script>');
    const id = stableClientId(store);
    expect(id).not.toBe('<script>');
    expect(store.data.get(VIBEPARTY_CLIENT_KEY)).toBe(id);

    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(stableClientId(broken)).toMatch(/^[\w-]{8,64}$/);
    expect(stableClientId(null)).toMatch(/^[\w-]{8,64}$/);
  });
});
