// The content script end to end, in a DOM: the "Watch together" button, invites from the address bar, and what the script
// says to the host. The host side is a plain recorder here (host.ts / realtime.test.ts cover the other half).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import { initVibeParty } from './content';
import { OVERLAY_HOST_ID } from './overlay';
import type { BackgroundToContent, ContentToBackground, RoomState } from './protocol';
import { WATCH_BUTTON_ID } from './watch-button';

const VID = 'dQw4w9WgXcQ';
const ROOM = 'amber-lofi-k7q2x9dm';

type Listener = (message: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => void;

let sent: ContentToBackground[];
let listener: Listener | null;
let teardown: (() => void) | null;
let href: string;
let clipboard: ReturnType<typeof vi.fn>;

const overlayRoot = () => document.getElementById(OVERLAY_HOST_ID)?.shadowRoot as ShadowRoot;
const buttonRoot = () => document.getElementById(WATCH_BUTTON_ID)?.shadowRoot as ShadowRoot;
const click = (el: Element | null | undefined) => el?.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
const fromHost = (msg: BackgroundToContent) => listener?.(msg, {}, () => {});
const last = <T extends ContentToBackground['type']>(type: T) =>
  sent.filter((m) => m.type === type).at(-1) as Extract<ContentToBackground, { type: T }> | undefined;

function state(over: Partial<RoomState> = {}): RoomState {
  return { room: ROOM, peers: [{ id: 'me', name: 'Alex' }], queue: [], chat: [], media: null, ...over };
}

function start(opts: { href?: string; watch?: boolean } = {}) {
  href = opts.href ?? `https://www.youtube.com/watch?v=${VID}`;
  document.body.innerHTML =
    '<div id="movie_player"><video></video></div><ytd-watch-metadata><div id="actions"><div id="top-level-buttons-computed"></div></div></ytd-watch-metadata>';
  const video = document.querySelector('video') as HTMLVideoElement;
  Object.defineProperty(video, 'currentTime', { value: 83.5, writable: true, configurable: true });
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true });
  initVibeParty({ onInvalidated: (cb: () => void) => (teardown = cb) } as never, {
    getVideoId: () => VID,
    getHref: () => href,
    replaceHref: (h) => {
      href = h;
    },
    isWatchPage: () => opts.watch ?? true,
    navigate: vi.fn(),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  listener = null;
  teardown = null;
  vi.spyOn(browser.runtime, 'sendMessage').mockImplementation((async (msg: ContentToBackground) => {
    sent.push(msg);
  }) as never);
  vi.spyOn(browser.runtime.onMessage, 'addListener').mockImplementation(((fn: Listener) => {
    listener = fn;
  }) as never);
  clipboard = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboard }, configurable: true });
  Element.prototype.scrollTo ??= () => {};
});
afterEach(() => {
  teardown?.();
  document.getElementById(OVERLAY_HOST_ID)?.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('Watch together', () => {
  it('puts the button next to the like / share buttons on a watch page, and says hello to the host', () => {
    start();
    expect(document.getElementById('top-level-buttons-computed')?.contains(document.getElementById(WATCH_BUTTON_ID))).toBe(true);
    expect(buttonRoot().querySelector('button')?.textContent).toBe('Watch together');
    expect(last('vibeparty:hello')).toBeDefined();
  });

  it('is not shown off the watch page', () => {
    start({ watch: false });
    expect(document.getElementById(WATCH_BUTTON_ID)).toBeNull();
  });

  it('one click: new room, invite on the clipboard, join — then the video’s position goes into the room and the panel opens', async () => {
    start();
    click(buttonRoot().querySelector('button'));

    const join = last('vibeparty:join');
    expect(join?.room).toMatch(/^[a-z]+-[a-z]+-[a-z2-9]{8}$/);
    expect(join?.name).toBe('guest');
    expect(clipboard).toHaveBeenCalledTimes(1);
    expect(clipboard.mock.calls[0]?.[0]).toContain(`room code: ${join?.room}`);
    expect(clipboard.mock.calls[0]?.[0]).toContain(`https://www.youtube.com/watch?v=${VID}&pact=${join?.room}`);

    sent.length = 0;
    fromHost({ type: 'vibeparty:joined', selfId: 'me', mode: 'connecting', state: state({ room: join?.room ?? ROOM }) });
    expect(last('vibeparty:media')).toEqual({ type: 'vibeparty:media', ev: 'seek', mediaTime: 83.5, playing: false, videoId: VID });
    expect(overlayRoot().querySelector('.vp')?.getAttribute('data-view')).toBe('party');
    expect(buttonRoot().querySelector('button')?.textContent).toBe('In party');
    expect(document.getElementById(OVERLAY_HOST_ID)?.style.display).toBe('block');
  });

  it('a double click starts one party, not two', () => {
    start();
    click(buttonRoot().querySelector('button'));
    click(buttonRoot().querySelector('button'));
    expect(sent.filter((m) => m.type === 'vibeparty:join')).toHaveLength(1);
    expect(clipboard).toHaveBeenCalledTimes(1);
  });

  it('uses the name pact saved, and clicking again while in the party just shows the panel instead of starting another', async () => {
    await browser.storage.local.set({ 'vibeparty:name': 'Riley' });
    start();
    await vi.advanceTimersByTimeAsync(10);
    click(buttonRoot().querySelector('button'));
    const join = last('vibeparty:join');
    expect(join?.name).toBe('Riley');

    fromHost({ type: 'vibeparty:joined', selfId: 'me', mode: 'live', state: state({ room: join?.room ?? ROOM }) });
    sent.length = 0;
    click(buttonRoot().querySelector('button'));
    expect(sent.filter((m) => m.type === 'vibeparty:join')).toHaveLength(0);
    expect(clipboard).toHaveBeenCalledTimes(1);
  });

  it('shows the room and the people from the host, and goes back to "Watch together" when the party ends', () => {
    start();
    fromHost({
      type: 'vibeparty:joined',
      selfId: 'me',
      mode: 'live',
      state: state({
        peers: [
          { id: 'me', name: 'Alex' },
          { id: 'p2', name: 'Sam' },
        ],
      }),
    });
    expect(buttonRoot().querySelector('button')?.textContent).toBe('In party · 2');
    expect(overlayRoot().querySelector('.vp-room')?.textContent).toBe(ROOM);
    fromHost({ type: 'vibeparty:presence', peers: [{ id: 'me', name: 'Alex' }] });
    expect(buttonRoot().querySelector('button')?.textContent).toBe('In party');
    fromHost({ type: 'vibeparty:left' });
    expect(buttonRoot().querySelector('button')?.textContent).toBe('Watch together');
    expect(document.getElementById(OVERLAY_HOST_ID)?.style.display).toBe('none');
  });
});

describe('connection state', () => {
  it('shows what the host says: live, reconnecting, and why a party is only local', () => {
    start();
    fromHost({ type: 'vibeparty:joined', selfId: 'me', mode: 'local', reason: 'signed-out', state: state() });
    expect(overlayRoot().querySelector('.vp-mode')?.textContent).toBe('This browser');
    expect(overlayRoot().querySelector('.vp-link-notice')?.textContent).toMatch(/sign in to pact/i);

    fromHost({ type: 'vibeparty:status', room: ROOM, mode: 'live' });
    expect(overlayRoot().querySelector('.vp-mode')?.textContent).toBe('Live');
    expect((overlayRoot().querySelector('.vp-link-notice') as HTMLElement).hidden).toBe(true);
    fromHost({ type: 'vibeparty:status', room: ROOM, mode: 'reconnecting' });
    expect(overlayRoot().querySelector('.vp-mode')?.textContent).toBe('Reconnecting…');
  });

  it('Retry and "Sign in to pact" are passed on to the host', () => {
    start();
    fromHost({ type: 'vibeparty:joined', selfId: 'me', mode: 'error', reason: 'failed', message: 'Can’t reach the party server.', state: state() });
    click([...overlayRoot().querySelectorAll('.vp-link-notice button')].find((b) => b.textContent?.includes('Try again')));
    expect(last('vibeparty:retry')).toBeDefined();
    fromHost({ type: 'vibeparty:status', room: ROOM, mode: 'local', reason: 'signed-out' });
    click([...overlayRoot().querySelectorAll('.vp-link-notice button')].find((b) => b.textContent?.includes('Sign in')));
    expect(last('vibeparty:open-pact')).toBeDefined();
  });
});

describe('invite links', () => {
  it('offers the party from `&pact=<code>` without joining, and takes the code out of the address bar', () => {
    start({ href: `https://www.youtube.com/watch?v=${VID}&pact=${ROOM}&t=30s` });
    expect(href).toBe(`https://www.youtube.com/watch?v=${VID}&t=30s`); // a room code is a password: not left in history
    expect(sent.filter((m) => m.type === 'vibeparty:join')).toHaveLength(0);
    const banner = overlayRoot().querySelector('.vp-invite') as HTMLElement;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain(ROOM);
    expect(document.getElementById(OVERLAY_HOST_ID)?.style.display).toBe('block');

    click(banner.querySelector('.vp-btn--primary'));
    expect(last('vibeparty:join')).toEqual({ type: 'vibeparty:join', room: ROOM, name: 'guest' });
  });

  it('ignores a malformed code', () => {
    start({ href: `https://www.youtube.com/watch?v=${VID}&pact=!!` });
    expect((overlayRoot().querySelector('.vp-invite') as HTMLElement).hidden).toBe(true);
    expect(document.getElementById(OVERLAY_HOST_ID)?.style.display).toBe('none');
  });

  it('notices an invite that arrives while we are already watching (YouTube navigates without reloading)', () => {
    start();
    href = `https://www.youtube.com/watch?v=${VID}&pact=${ROOM}`;
    document.dispatchEvent(new Event('yt-navigate-finish'));
    expect((overlayRoot().querySelector('.vp-invite') as HTMLElement).hidden).toBe(false);
    expect(href).toBe(`https://www.youtube.com/watch?v=${VID}`);
  });
});
