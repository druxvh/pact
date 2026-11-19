import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ContentHooks, initNowPlayingContent, KEEPALIVE_IDLE_MS, KEEPALIVE_PLAYING_MS, POLL_MS } from './content';
import type { ContentReport } from './protocol';
import type { Snapshot } from './reader';

const GUARD = Symbol.for('pact.nowplaying.content');

let sent: ContentReport[];
let snap: Snapshot;
let clock: number;
let invalid: boolean;
let disposers: Array<() => void>;

/** The parts of WXT's ContentScriptContext the script uses, backed by the real timers/events (and undone after each test). */
const fakeContext = () =>
  ({
    get isValid() {
      return !invalid;
    },
    setInterval: (fn: () => void, ms: number) => window.setInterval(fn, ms),
    addEventListener: (target: EventTarget, type: string, fn: () => void, options?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, options);
      disposers.push(() => target.removeEventListener(type, fn, options));
    },
  }) as never;

const song = (over: Partial<Snapshot> = {}): Snapshot => ({
  playing: true,
  title: 'Night Drive',
  artist: 'The Tests',
  album: '',
  artwork: '',
  link: '',
  ...over,
});

function start(hooks: ContentHooks = {}) {
  initNowPlayingContent(fakeContext(), { read: () => snap, send: (r) => void sent.push(r), now: () => clock, hostname: 'open.spotify.com', ...hooks });
}
const advance = (ms: number) => {
  clock += ms;
  vi.advanceTimersByTime(ms);
};

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  snap = song();
  clock = 1_000_000;
  invalid = false;
  disposers = [];
  delete (globalThis as Record<symbol, unknown>)[GUARD];
});
afterEach(() => {
  for (const dispose of disposers) dispose();
  vi.useRealTimers();
  delete (globalThis as Record<symbol, unknown>)[GUARD];
});

describe('the music-tab content script', () => {
  it('says what is playing right away, then only when something changes', () => {
    start();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'nowplaying:report', playing: true, title: 'Night Drive' });
    advance(POLL_MS * 3);
    expect(sent).toHaveLength(1); // nothing changed
    snap = song({ title: 'Second song' });
    advance(POLL_MS);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.title).toBe('Second song');
    snap = song({ title: 'Second song', playing: false });
    advance(POLL_MS);
    expect(sent).toHaveLength(3);
    expect(sent[2]?.playing).toBe(false);
  });

  it('says it is still there now and then — every 20 s while playing, every minute otherwise', () => {
    start();
    advance(KEEPALIVE_PLAYING_MS - POLL_MS);
    expect(sent).toHaveLength(1);
    advance(POLL_MS);
    expect(sent).toHaveLength(2);

    snap = song({ playing: false });
    advance(POLL_MS);
    expect(sent).toHaveLength(3); // the change
    advance(KEEPALIVE_IDLE_MS - POLL_MS * 2);
    expect(sent).toHaveLength(3);
    advance(POLL_MS * 2);
    expect(sent).toHaveLength(4);
  });

  it('reacts at once to a media element pausing or playing, without waiting for the next poll', () => {
    start();
    snap = song({ playing: false });
    document.dispatchEvent(new Event('pause'));
    expect(sent).toHaveLength(2);
    expect(sent[1]?.playing).toBe(false);
    snap = song();
    document.dispatchEvent(new Event('play'));
    expect(sent).toHaveLength(3);
  });

  it('says goodbye when the page goes away, and again where it is when restored from the back/forward cache', () => {
    start();
    window.dispatchEvent(new Event('pagehide'));
    expect(sent.at(-1)).toMatchObject({ playing: false, title: '', artist: '' });
    const before = sent.length;
    window.dispatchEvent(new Event('pageshow'));
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)).toMatchObject({ title: 'Night Drive' });
  });

  it('does nothing on a page that is not one of the players', () => {
    start({ hostname: 'www.youtube.com' });
    start({ hostname: 'evil.example' });
    advance(POLL_MS * 5);
    expect(sent).toHaveLength(0);
  });

  it('runs once per page: a second injection (feature turned on while the tab was open) changes nothing', () => {
    start();
    start();
    advance(POLL_MS * 2);
    expect(sent).toHaveLength(1);
  });

  it('stops when the extension context is gone (reloaded / disabled)', () => {
    start();
    invalid = true;
    snap = song({ title: 'After reload' });
    advance(POLL_MS * 3);
    expect(sent).toHaveLength(1);
  });

  it('a page that breaks Media Session can’t break the script', () => {
    start({
      read: () => {
        throw new Error('page broke it');
      },
    });
    expect(() => advance(POLL_MS * 2)).not.toThrow();
    expect(sent).toHaveLength(0);
  });

  it('sends only the report fields — never the page address or title', () => {
    document.title = 'Some page title';
    start();
    expect(Object.keys(sent[0] ?? {}).sort()).toEqual(['album', 'artist', 'artwork', 'link', 'playing', 'title', 'type']);
  });
});
