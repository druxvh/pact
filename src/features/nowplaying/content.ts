/**
 * Runs inside an open music tab (spotify, youtube music, …) — and only there: it is registered at runtime, for just the players
 * the person gave permission for, when they turn the feature on (see scripts.ts); it is not a static `content_scripts` entry,
 * so it adds no install warning. It reads the player's Media Session (reader.ts) and tells the service worker when something
 * changed (and now and then that it is still there). It never sends the tab's address or title.
 *
 * Polls every couple of seconds — Media Session has no change event — and also reacts at once to the media elements'
 * play / pause events. A tab that is playing audio isn't throttled, so this keeps working in a background tab.
 */
import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ContentReport } from './protocol.ts';
import { type MediaSessionLike, readSnapshot, type Snapshot } from './reader.ts';
import { sourceForHost } from './sources.ts';

export const POLL_MS = 2000;
/** Said again even if nothing changed, so the service worker knows this tab is still alive. Longer when nothing is playing. */
export const KEEPALIVE_PLAYING_MS = 20_000;
export const KEEPALIVE_IDLE_MS = 60_000;

const GUARD = Symbol.for('pact.nowplaying.content');

/** Seams for tests; the extension passes nothing. */
export type ContentHooks = {
  read?(): Snapshot;
  send?(report: ContentReport): void;
  now?(): number;
  hostname?: string;
};

export function initNowPlayingContent(ctx?: ContentScriptContext, hooks: ContentHooks = {}): void {
  const hostname = hooks.hostname ?? location.hostname;
  const source = sourceForHost(hostname);
  if (!source) return; // not one of the players: read nothing, say nothing

  // Injected twice into the same page (turned on while the tab was open, then registered too): one copy only.
  const holder = globalThis as unknown as Record<symbol, { ctx?: ContentScriptContext } | undefined>;
  const previous = holder[GUARD];
  if (previous && (previous.ctx === undefined || previous.ctx.isValid)) return;
  holder[GUARD] = { ctx };

  const now = hooks.now ?? Date.now;
  const read =
    hooks.read ??
    (() =>
      readSnapshot({
        mediaSession: (navigator as Navigator & { mediaSession?: MediaSessionLike }).mediaSession,
        doc: document,
        href: location.href,
        source,
      }));
  const send =
    hooks.send ??
    ((report: ContentReport) => {
      try {
        void browser.runtime.sendMessage(report).catch(() => {});
      } catch {
        /* the extension was reloaded under this page: ctx cleans up */
      }
    });

  let lastKey: string | null = null;
  let lastSentAt = 0;

  const emit = (snap: Snapshot, force = false) => {
    const key = JSON.stringify(snap);
    const due = now() - lastSentAt >= (snap.playing ? KEEPALIVE_PLAYING_MS : KEEPALIVE_IDLE_MS);
    if (!force && key === lastKey && !due) return;
    lastKey = key;
    lastSentAt = now();
    send({ type: 'nowplaying:report', ...snap });
  };
  const tick = () => {
    if (ctx && !ctx.isValid) return;
    try {
      emit(read());
    } catch {
      /* a page that breaks Media Session isn't ours to fix */
    }
  };
  const goodbye = () => {
    lastKey = null;
    send({ type: 'nowplaying:report', playing: false, title: '', artist: '', album: '', artwork: '', link: '' });
  };

  const every = (fn: () => void, ms: number) => (ctx ? ctx.setInterval(fn, ms) : window.setInterval(fn, ms));
  const listen = (target: EventTarget, type: string, fn: () => void, capture = false) => {
    if (ctx) ctx.addEventListener(target, type as never, fn, { capture });
    else target.addEventListener(type, fn, { capture });
  };

  every(tick, POLL_MS);
  // `play` / `pause` don't bubble, but they can be caught on the way down.
  for (const type of ['play', 'playing', 'pause', 'ended', 'emptied']) listen(document, type, tick, true);
  listen(document, 'visibilitychange', tick);
  listen(window, 'pagehide', goodbye);
  listen(window, 'pageshow', () => {
    lastKey = null; // restored from the back/forward cache: say where we are again
    tick();
  });
  tick();
}
