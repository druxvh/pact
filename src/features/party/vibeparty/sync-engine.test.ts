import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type LocalMediaEvent, SYNC, SyncEngine } from './sync-engine';

const VID = 'dQw4w9WgXcQ';

/** Just enough of HTMLVideoElement. Like a real one, it fires events only when WE tell it to (they arrive late in real life). */
class FakeVideo extends EventTarget {
  currentTime = 0;
  paused = true;
  ended = false;
  seeking = false;
  playbackRate = 1;
  readyState = 4;
  duration = 600;
  playImpl: () => Promise<void> = () => Promise.resolve();
  play = vi.fn(() => {
    this.paused = false;
    return this.playImpl();
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

function setup() {
  const video = new FakeVideo();
  const state = { ad: false, id: VID as string | null };
  const events: LocalMediaEvent[] = [];
  const mismatches: string[] = [];
  const ads: boolean[] = [];
  const counts = { resync: 0, blocked: 0 };
  const engine = new SyncEngine({
    onLocalEvent: (e) => events.push(e),
    onVideoMismatch: (id) => mismatches.push(id),
    onAdChange: (a) => ads.push(a),
    onNeedResync: () => {
      counts.resync++;
    },
    onPlayBlocked: () => {
      counts.blocked++;
    },
    findVideo: () => video as unknown as HTMLVideoElement,
    isAdShowing: () => state.ad,
    getVideoId: () => state.id,
  });
  engine.setActive(true);
  return { video, state, events, mismatches, ads, counts, engine };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('reporting what the local viewer does', () => {
  it('emits play / pause / ended with the position and video id', () => {
    const { video, events } = setup();
    video.currentTime = 12;
    video.paused = false;
    video.fire('play');
    video.currentTime = 20;
    video.paused = true;
    video.fire('pause');
    expect(events).toEqual([
      { ev: 'play', mediaTime: 12, playing: true, videoId: VID },
      { ev: 'pause', mediaTime: 20, playing: false, videoId: VID },
    ]);
  });

  it('reports a finished video once: the pause that precedes `ended` is swallowed', () => {
    const { video, events } = setup();
    video.currentTime = 600;
    video.ended = true;
    video.paused = true;
    video.fire('pause');
    video.fire('ended');
    expect(events).toEqual([{ ev: 'ended', mediaTime: 600, playing: false, videoId: VID }]);
  });

  it('coalesces a scrub (many `seeked`) into one seek at the final position', () => {
    const { video, events } = setup();
    for (const t of [30, 31, 32]) {
      video.currentTime = t;
      video.fire('seeked');
      vi.advanceTimersByTime(100);
    }
    expect(events).toHaveLength(0);
    vi.advanceTimersByTime(SYNC.seekDebounceMs);
    expect(events).toEqual([{ ev: 'seek', mediaTime: 32, playing: false, videoId: VID }]);
  });

  it('does nothing at all until a party is joined, and lets go cleanly when it is left', () => {
    const { video, events, engine } = setup();
    engine.setActive(false);
    video.fire('play');
    engine.applyRemote({ playing: true, mediaTime: 50, videoId: VID });
    expect(events).toHaveLength(0);
    expect(video.play).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(0);
  });
});

describe('applying the room’s state without echoing it back', () => {
  it('seeks, plays, and swallows the resulting events even when they arrive long after the old 250 ms lock', () => {
    const { video, events, engine } = setup();
    engine.applyRemote({ playing: true, mediaTime: 30, videoId: VID });
    expect(video.currentTime).toBe(30);
    expect(video.play).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1500);
    video.fire('seeked');
    video.fire('play');
    vi.advanceTimersByTime(SYNC.seekDebounceMs * 2);
    expect(events).toEqual([]);
  });

  it('pauses on a remote pause (and does not echo that either)', () => {
    const { video, events, engine } = setup();
    video.paused = false;
    engine.applyRemote({ playing: false, mediaTime: 5, videoId: VID });
    expect(video.pause).toHaveBeenCalledTimes(1);
    video.fire('seeked');
    video.fire('pause');
    vi.advanceTimersByTime(500);
    expect(events).toEqual([]);
  });

  it('a stale expectation expires, so a genuine later action is still reported', () => {
    const { video, events, engine } = setup();
    engine.applyRemote({ playing: true, mediaTime: 0, videoId: VID }); // the 'play' event never arrives
    vi.advanceTimersByTime(SYNC.expectTtlMs + 500);
    video.currentTime = 9;
    video.fire('play'); // the viewer paused and pressed play again
    expect(events.map((e) => e.ev)).toEqual(['play']);
  });

  it('asks the viewer to click when the browser blocks autoplay — and then treats their click as theirs', async () => {
    const { video, events, counts, engine } = setup();
    video.playImpl = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    engine.applyRemote({ playing: true, mediaTime: 10, videoId: VID });
    await vi.advanceTimersByTimeAsync(0);
    expect(counts.blocked).toBe(1);
    video.fire('play');
    expect(events.map((e) => e.ev)).toEqual(['play']);
  });

  it('keeps a command until the player is ready, then applies it extrapolated for the wait', () => {
    const { video, engine } = setup();
    video.readyState = 0;
    engine.applyRemote({ playing: true, mediaTime: 30, videoId: VID });
    expect(video.play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(video.currentTime).toBe(0);

    video.readyState = 1;
    video.fire('loadedmetadata');
    expect(video.currentTime).toBeCloseTo(35, 0);
    expect(video.play).toHaveBeenCalledTimes(1);
  });

  it('gives up on a command that has waited too long', () => {
    const { video, engine } = setup();
    video.readyState = 0;
    engine.applyRemote({ playing: true, mediaTime: 30, videoId: VID });
    vi.advanceTimersByTime(SYNC.pendingTtlMs + 1000);
    video.readyState = 4;
    vi.advanceTimersByTime(SYNC.tickMs);
    expect(video.play).not.toHaveBeenCalled();
  });

  it('does not touch the player when the room is watching a different video', () => {
    const { video, state, mismatches, engine } = setup();
    state.id = 'other-video1';
    engine.applyRemote({ playing: true, mediaTime: 30, videoId: VID });
    expect(mismatches).toEqual([VID]);
    expect(video.play).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(0);
  });

  it('lands exactly when paused, but ignores sub-second gaps while playing (drift correction handles those)', () => {
    const paused = setup();
    paused.video.currentTime = 40;
    paused.engine.applyRemote({ playing: false, mediaTime: 40.3, videoId: VID });
    expect(paused.video.currentTime).toBe(40.3);

    const playing = setup();
    playing.video.currentTime = 40;
    playing.video.paused = false;
    playing.engine.applyRemote({ playing: true, mediaTime: 40.4, videoId: VID });
    expect(playing.video.currentTime).toBe(40);
  });
});

describe('advertisements', () => {
  it('ads never reach the room, remote commands wait, and a fresh position is requested afterwards', () => {
    const { video, state, events, ads, counts, engine } = setup();
    state.ad = true;
    vi.advanceTimersByTime(SYNC.tickMs);
    expect(ads).toEqual([true]);

    video.paused = false;
    video.fire('play');
    video.fire('seeked');
    video.fire('pause');
    vi.advanceTimersByTime(SYNC.seekDebounceMs * 2);
    expect(events).toEqual([]);

    engine.applyRemote({ playing: true, mediaTime: 40, videoId: VID });
    expect(video.currentTime).toBe(0); // never seek an ad

    state.ad = false;
    vi.advanceTimersByTime(SYNC.tickMs);
    expect(ads).toEqual([true, false]);
    expect(video.currentTime).toBeGreaterThanOrEqual(40); // the held command applies as soon as the ad is over
    vi.advanceTimersByTime(SYNC.resyncDelayMs + 50);
    expect(counts.resync).toBe(1);
  });
});

describe('drift correction', () => {
  /** Start in sync at t=100 and let one tick elapse; `at` is the player position the next tick will observe. */
  function playingAt100() {
    const ctx = setup();
    ctx.engine.applyRemote({ playing: true, mediaTime: 100, videoId: VID });
    ctx.video.fire('seeked'); // consumes the seek expectation
    ctx.video.fire('play');
    return ctx;
  }

  it('slows down when ahead, speeds up when behind, and returns to 1× when close', () => {
    const { video } = playingAt100();
    video.currentTime = 101.5; // expected 101 after 1 s → 0.5 s ahead
    vi.advanceTimersByTime(SYNC.tickMs);
    expect(video.playbackRate).toBe(SYNC.nudgeSlow);

    video.currentTime = 100.5 + 1; // now 2 s elapsed → expected 102; we're 0.5 behind
    vi.advanceTimersByTime(SYNC.tickMs);
    expect(video.playbackRate).toBe(SYNC.nudgeFast);

    video.currentTime = 103.05; // expected 103 → 50 ms off
    vi.advanceTimersByTime(SYNC.tickMs);
    expect(video.playbackRate).toBe(1);
  });

  it('hard-seeks when badly off, without echoing the seek to the room', () => {
    const { video, events } = playingAt100();
    video.currentTime = 110;
    vi.advanceTimersByTime(SYNC.tickMs);
    expect(video.currentTime).toBeCloseTo(101, 1);
    expect(video.playbackRate).toBe(1);
    video.fire('seeked');
    vi.advanceTimersByTime(SYNC.seekDebounceMs * 2);
    expect(events).toEqual([]);
  });

  it('keeps playback at 1× while in a party, whatever the viewer picked', () => {
    const { video } = playingAt100();
    video.playbackRate = 1.5;
    video.currentTime = 101;
    vi.advanceTimersByTime(SYNC.tickMs);
    expect(video.playbackRate).toBe(1);
  });

  it('does not fight a buffering player', () => {
    const { video } = playingAt100();
    video.readyState = 2; // stalled
    video.currentTime = 100;
    vi.advanceTimersByTime(SYNC.tickMs * 3);
    expect(video.playbackRate).toBe(1);
    expect(video.currentTime).toBe(100);
  });

  it('restores normal speed when the party ends', () => {
    const { video, engine } = playingAt100();
    video.currentTime = 101.5;
    vi.advanceTimersByTime(SYNC.tickMs);
    expect(video.playbackRate).toBe(SYNC.nudgeSlow);
    engine.setActive(false);
    expect(video.playbackRate).toBe(1);
  });
});

describe('finding out where the room is', () => {
  it('asks after the player (re)loads and nothing is pending', () => {
    const { video, counts } = setup();
    video.fire('loadedmetadata');
    expect(counts.resync).toBe(0);
    vi.advanceTimersByTime(SYNC.resyncDelayMs + 50);
    expect(counts.resync).toBe(1);
  });

  it('…but not if the viewer starts steering in the meantime', () => {
    const { video, counts } = setup();
    video.fire('loadedmetadata');
    vi.advanceTimersByTime(300);
    video.paused = false;
    video.fire('play');
    vi.advanceTimersByTime(SYNC.resyncDelayMs * 2);
    expect(counts.resync).toBe(0);
  });
});
