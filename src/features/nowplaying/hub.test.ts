import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_MS, type HubDeps, NowPlayingHub, PUBLISH_DELAY_MS, parseSaved, TAB_TTL_MS, type TabState, UNAVAILABLE_BACKOFF_MS } from './hub';
import type { ContentReport, LocalNow, NowPlayingConfig, PublishResult } from './protocol';
import type { Track } from './track';

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let clock: number;
let published: Track[];
let cleared: number;
let emitted: Array<LocalNow | null>;
let alarm: boolean;
let rejected: number;
let saved: Array<{ tabs: Array<[number, TabState]>; held: boolean }>;
let answer: PublishResult;
let hub: NowPlayingHub;

const deps = (): HubDeps => ({
  now: () => clock,
  publish: async (track) => {
    published.push(track);
    return answer;
  },
  clear: async () => {
    cleared++;
  },
  emit: (now) => void emitted.push(now),
  setAlarm: (on) => {
    alarm = on;
  },
  shareRejected: () => {
    rejected++;
  },
  save: (state) => void saved.push(state),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
});

const SHARING: NowPlayingConfig = { detect: true, share: 'communities', paused: false };
const report = (over: Partial<ContentReport> = {}): ContentReport => ({
  type: 'nowplaying:report',
  playing: true,
  title: 'Night Drive',
  artist: 'The Tests',
  album: '',
  artwork: '',
  link: '',
  ...over,
});
const SPOTIFY = 'https://open.spotify.com/album/1';
const YTM = 'https://music.youtube.com/watch?v=abc';
const last = () => emitted.at(-1);

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
  published = [];
  cleared = 0;
  emitted = [];
  alarm = false;
  rejected = 0;
  saved = [];
  answer = 'ok';
  hub = new NowPlayingHub(deps());
});

const wait = async (ms: number) => {
  clock += ms;
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
};

describe('which tab is "now playing"', () => {
  beforeEach(() => hub.setConfig({ detect: true, share: 'off', paused: false }));

  it('is the tab that is playing; a paused tab shows as paused when nothing plays', () => {
    hub.report(1, SPOTIFY, report({ playing: false }));
    expect(last()).toMatchObject({ playing: false, track: { title: 'Night Drive', source: 'spotify' } });
    hub.report(2, YTM, report({ title: 'Other', playing: true }));
    expect(last()).toMatchObject({ playing: true, track: { title: 'Other', source: 'youtube-music' } });
  });

  it('with several tabs playing, the one that started most recently wins — and the older one comes back when it stops', async () => {
    hub.report(1, SPOTIFY, report({ title: 'First' }));
    await wait(5000);
    hub.report(2, YTM, report({ title: 'Second' }));
    expect(last()?.track.title).toBe('Second');
    await wait(5000);
    hub.report(1, SPOTIFY, report({ title: 'First' })); // a keepalive from the older tab doesn't make it "newer"
    expect(last()?.track.title).toBe('Second');
    hub.report(2, YTM, report({ title: 'Second', playing: false }));
    expect(last()).toMatchObject({ playing: true, track: { title: 'First' } });
  });

  it('a new track in the same tab counts as newly started', async () => {
    hub.report(1, SPOTIFY, report({ title: 'A' }));
    await wait(1000);
    hub.report(2, YTM, report({ title: 'B' }));
    await wait(1000);
    hub.report(1, SPOTIFY, report({ title: 'A2' }));
    expect(last()?.track.title).toBe('A2');
  });

  it('closing the tab drops it; closing the last one leaves nothing', () => {
    hub.report(1, SPOTIFY, report());
    hub.report(2, YTM, report({ title: 'Other', playing: false }));
    hub.tabClosed(1);
    expect(last()).toMatchObject({ playing: false, track: { title: 'Other' } });
    hub.tabClosed(2);
    expect(last()).toBeNull();
  });

  it('a tab that goes quiet for too long is forgotten', async () => {
    hub.report(1, SPOTIFY, report());
    await wait(TAB_TTL_MS + 1000);
    hub.tick();
    expect(last()).toBeNull();
  });

  it('a report with no title (a player with nothing to say) removes the tab', () => {
    hub.report(1, SPOTIFY, report());
    hub.report(1, SPOTIFY, report({ title: '', playing: false }));
    expect(last()).toBeNull();
  });
});

describe('what is accepted', () => {
  beforeEach(() => hub.setConfig({ detect: true, share: 'off', paused: false }));

  it('the player is worked out from the tab’s own address — a report can’t claim to be something else', () => {
    hub.report(1, SPOTIFY, { ...report(), source: 'tidal' } as ContentReport);
    expect(last()?.track.source).toBe('spotify');
  });

  it('a tab that isn’t a recognised music player is dropped, with nothing about it going anywhere', () => {
    for (const url of ['https://www.youtube.com/watch?v=1', 'https://evil.example/', 'http://open.spotify.com/', undefined, 'garbage'])
      hub.report(1, url, report());
    expect(emitted.every((e) => e === null)).toBe(true);
    expect(published).toHaveLength(0);
  });

  it('text and addresses are cleaned: hostile artwork and links are dropped, the title is text', () => {
    hub.report(
      1,
      SPOTIFY,
      report({ title: `<b>x</b>${String.fromCodePoint(0x202e)}`, artwork: 'https://attacker.example/pixel.gif', link: 'javascript:alert(1)' }),
    );
    expect(last()?.track).toMatchObject({ title: '<b>x</b>', artworkUrl: null, trackUrl: null });
  });

  it('with detecting off it ignores everything', () => {
    hub.setConfig({ detect: false, share: 'communities', paused: false });
    hub.report(1, SPOTIFY, report());
    expect(last()).toBeNull();
    expect(published).toHaveLength(0);
  });
});

describe('publishing', () => {
  beforeEach(() => hub.setConfig(SHARING));

  it('a new track is held back a few seconds (skipping songs publishes nothing), then published', async () => {
    hub.report(1, SPOTIFY, report({ title: 'A' }));
    await wait(1000);
    hub.report(1, SPOTIFY, report({ title: 'B' }));
    await wait(1000);
    hub.report(1, SPOTIFY, report({ title: 'C' }));
    await wait(PUBLISH_DELAY_MS - 100);
    expect(published).toHaveLength(0);
    await wait(200);
    expect(published.map((t) => t.title)).toEqual(['C']);
    expect(last()).toMatchObject({ shared: true });
  });

  it('keeps publishing the same track as a heartbeat, no more often than that', async () => {
    hub.report(1, SPOTIFY, report());
    await wait(PUBLISH_DELAY_MS + 100);
    expect(published).toHaveLength(1);
    for (let i = 0; i < 4; i++) {
      await wait(5000);
      hub.report(1, SPOTIFY, report()); // the tab's own keepalives
    }
    expect(published).toHaveLength(1); // 20 s since the last one: not yet
    await wait(6000);
    hub.tick();
    await flush();
    expect(published).toHaveLength(2);
  });

  it('pausing, or the tab closing, removes it at once', async () => {
    hub.report(1, SPOTIFY, report());
    await wait(PUBLISH_DELAY_MS + 100);
    expect(published).toHaveLength(1);
    hub.report(1, SPOTIFY, report({ playing: false }));
    await flush();
    expect(cleared).toBe(1);
    expect(last()).toMatchObject({ playing: false, shared: false });
    hub.report(1, SPOTIFY, report());
    await wait(PUBLISH_DELAY_MS + 100);
    expect(published).toHaveLength(2);
    hub.tabClosed(1);
    await flush();
    expect(cleared).toBe(2);
  });

  it('a track paused before it was ever published is never published', async () => {
    hub.report(1, SPOTIFY, report());
    await wait(1000);
    hub.report(1, SPOTIFY, report({ playing: false }));
    await wait(PUBLISH_DELAY_MS * 2);
    expect(published).toHaveLength(0);
    expect(cleared).toBe(0); // nothing to remove
  });

  it('"pause sharing" removes it and stops publishing, while the widget keeps showing the track; resuming publishes again', async () => {
    hub.report(1, SPOTIFY, report());
    await wait(PUBLISH_DELAY_MS + 100);
    hub.setConfig({ ...SHARING, paused: true });
    await flush();
    expect(cleared).toBe(1);
    expect(last()).toMatchObject({ playing: true, shared: false, track: { title: 'Night Drive' } });
    await wait(HEARTBEAT_MS * 2);
    hub.tick();
    expect(published).toHaveLength(1);
    hub.setConfig(SHARING);
    await flush();
    expect(published).toHaveLength(2); // user action: no delay
  });

  it('turning sharing off removes it; turning it on publishes at once', async () => {
    hub.report(1, SPOTIFY, report());
    await wait(PUBLISH_DELAY_MS + 100);
    hub.setConfig({ ...SHARING, share: 'off' });
    await flush();
    expect(cleared).toBe(1);
    hub.setConfig({ ...SHARING, share: 'everyone' });
    await flush();
    expect(published).toHaveLength(2);
  });

  it('turning detection off removes it and forgets every tab', async () => {
    hub.report(1, SPOTIFY, report());
    await wait(PUBLISH_DELAY_MS + 100);
    hub.setConfig({ ...SHARING, detect: false });
    await flush();
    expect(cleared).toBe(1);
    expect(last()).toBeNull();
    expect(alarm).toBe(false);
  });

  it('with sharing off nothing is ever published or cleared — the "off" promise', async () => {
    hub.setConfig({ detect: true, share: 'off', paused: false });
    hub.report(1, SPOTIFY, report());
    await wait(PUBLISH_DELAY_MS * 3);
    hub.tick();
    hub.report(1, SPOTIFY, report({ playing: false }));
    await flush();
    expect(published).toHaveLength(0);
    expect(cleared).toBe(0);
    expect(last()).toMatchObject({ playing: false }); // the widget still has it
  });

  it('only the playing track of the chosen tab is published (a paused tab elsewhere never is)', async () => {
    hub.report(1, YTM, report({ title: 'Paused one', playing: false }));
    hub.report(2, SPOTIFY, report({ title: 'Playing one' }));
    await wait(PUBLISH_DELAY_MS + 100);
    expect(published.map((t) => t.title)).toEqual(['Playing one']);
  });

  it('runs the alarm while something plays or is published, and not otherwise', async () => {
    expect(alarm).toBe(false);
    hub.report(1, SPOTIFY, report({ playing: false }));
    expect(alarm).toBe(false);
    hub.report(1, SPOTIFY, report());
    expect(alarm).toBe(true);
    hub.tabClosed(1);
    await flush();
    expect(alarm).toBe(false);
  });
});

describe('when publishing doesn’t work', () => {
  beforeEach(() => hub.setConfig(SHARING));

  it('an error is retried on the next heartbeat, not in a loop', async () => {
    answer = 'error';
    hub.report(1, SPOTIFY, report());
    await wait(PUBLISH_DELAY_MS + 100);
    expect(published).toHaveLength(1);
    expect(last()).toMatchObject({ shared: false });
    await wait(10_000);
    hub.report(1, SPOTIFY, report());
    await wait(10_000);
    hub.report(1, SPOTIFY, report());
    expect(published).toHaveLength(1);
    answer = 'ok';
    await wait(HEARTBEAT_MS);
    hub.tick();
    await flush();
    expect(published).toHaveLength(2);
    expect(last()).toMatchObject({ shared: true });
  });

  it('signed out and rate-limited are treated the same way: tried again later, and the track stays clearable', async () => {
    for (const result of ['signed-out', 'rate-limited'] as const) {
      answer = result;
      hub = new NowPlayingHub(deps());
      hub.setConfig(SHARING);
      hub.report(1, SPOTIFY, report());
      await wait(PUBLISH_DELAY_MS + 100);
      expect(last()).toMatchObject({ shared: false });
      hub.report(1, SPOTIFY, report({ playing: false }));
      await flush();
    }
    expect(cleared).toBe(2);
  });

  it('"not shared" (the account says no) turns the preference off at once and stops', async () => {
    answer = 'not-shared';
    hub.report(1, SPOTIFY, report());
    await wait(PUBLISH_DELAY_MS + 100);
    expect(rejected).toBe(1);
    await wait(HEARTBEAT_MS * 2);
    hub.tick();
    await flush();
    expect(published).toHaveLength(1);
    expect(cleared).toBe(0);
  });

  it('"unavailable" (the database update isn’t applied) backs off for a long while', async () => {
    answer = 'unavailable';
    hub.report(1, SPOTIFY, report());
    await wait(PUBLISH_DELAY_MS + 100);
    await wait(HEARTBEAT_MS * 3);
    hub.tick();
    await flush();
    expect(published).toHaveLength(1);
    await wait(UNAVAILABLE_BACKOFF_MS);
    answer = 'ok';
    hub.report(1, SPOTIFY, report());
    await wait(PUBLISH_DELAY_MS + 100);
    expect(published).toHaveLength(2);
  });

  it('a publisher that throws is an error, not a crash', async () => {
    const d = deps();
    d.publish = async () => {
      throw new Error('boom');
    };
    hub = new NowPlayingHub(d);
    hub.setConfig(SHARING);
    hub.report(1, SPOTIFY, report());
    await wait(PUBLISH_DELAY_MS + 100);
    expect(last()).toMatchObject({ shared: false });
  });
});

describe('surviving a service-worker restart', () => {
  it('remembers the open tabs and that the publisher may hold a track, so it can still be cleared', async () => {
    hub.setConfig(SHARING);
    hub.report(1, SPOTIFY, report());
    await wait(PUBLISH_DELAY_MS + 100);
    const state = parseSaved(JSON.parse(JSON.stringify(saved.at(-1))));
    expect(state.held).toBe(true);
    expect(state.tabs).toHaveLength(1);

    // …a new worker starts with that state
    cleared = 0;
    hub = new NowPlayingHub(deps(), state);
    hub.setConfig(SHARING);
    expect(last()).toMatchObject({ track: { title: 'Night Drive' } });
    hub.tabClosed(1); // the tab closed while the worker slept
    await flush();
    expect(cleared).toBe(1);
    expect(last()).toBeNull();
  });

  it('a saved state that is odd or hostile is cleaned or dropped, never trusted', () => {
    expect(parseSaved(null)).toEqual({ tabs: [], held: false });
    expect(parseSaved({ tabs: 'x', held: 'yes' })).toEqual({ tabs: [], held: false });
    const good = {
      source: 'spotify',
      track: { title: 'T', artist: '', album: '', artworkUrl: 'https://evil.example/a.png', trackUrl: null, source: 'spotify' },
      playing: true,
      since: 1,
      seenAt: 2,
    };
    const out = parseSaved({
      tabs: [[1, good], ['x', good], [2, { ...good, source: 'napster' }], [3, { ...good, track: { title: '' } }], [4, null], 'nope'],
      held: true,
    });
    expect(out.tabs.map(([id]) => id)).toEqual([1]);
    expect(out.tabs[0]?.[1].track.artworkUrl).toBeNull(); // re-validated
    expect(out.held).toBe(true);
  });
});
