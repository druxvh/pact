/**
 * "Now playing" — the messages and stored shapes between the pieces. The path:
 *
 *   music tab ──content script──▶ service worker ──runtime message──▶ publisher (offscreen page / Firefox background page)
 *                                       │                                       │
 *                                       ▼ storage.session (what the new tab shows)   ▼ Supabase, only when the person chose to share
 *
 * Preferences go the other way: the new-tab page writes `CONFIG_KEY` to `storage.local`, and the service worker follows it.
 *
 * Dependency-free (explicit `.ts` specifiers) so every context and the tests can import it. Everything that arrives over
 * extension messaging is validated by the parsers here: "never throw, return null".
 */
import { parseTrack, type Track } from './track.ts';

export const VISIBILITIES = ['off', 'communities', 'everyone'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const isVisibility = (v: unknown): v is Visibility => typeof v === 'string' && (VISIBILITIES as readonly string[]).includes(v);

/** What the person asked for (this browser). `detect` also needs the browser permissions — `hasMusicAccess()` checks those. */
export type NowPlayingConfig = {
  /** Read what plays in open music tabs (needs the optional host permissions). Everything below only matters when this is on. */
  detect: boolean;
  /** Who may see it — the account's setting, copied here so the service worker never sends anything while it is "off". */
  share: Visibility;
  /** "Pause sharing": keep detecting for the widget, but publish nothing and remove what is published. */
  paused: boolean;
};
export const NO_CONFIG: NowPlayingConfig = { detect: false, share: 'off', paused: false };

/** `chrome.storage.local`: the preference (written by the new-tab page). */
export const CONFIG_KEY = 'nowplaying:config';
/** `chrome.storage.session`: what is playing in this browser right now (written by the service worker, read by the new-tab page). */
export const CURRENT_KEY = 'nowplaying:current';
/** `chrome.storage.session`: the worker's own memory (open music tabs, "the publisher may hold a track") across its restarts. */
export const STATE_KEY = 'nowplaying:state';
/** The alarm that wakes the service worker while something is playing (heartbeat + expiry). 30 s is `chrome.alarms`' floor. */
export const ALARM = 'nowplaying:tick';
export const ALARM_PERIOD_MINUTES = 0.5;
/** The id the content script is registered under. */
export const SCRIPT_ID = 'pact-nowplaying';
/** Where the bundled content script lives (WXT builds `entrypoints/nowplaying.content.ts` here). */
export const SCRIPT_FILE = 'content-scripts/nowplaying.js';

export function parseConfig(raw: unknown): NowPlayingConfig {
  if (typeof raw !== 'object' || raw === null) return NO_CONFIG;
  const r = raw as Record<string, unknown>;
  return { detect: r.detect === true, share: isVisibility(r.share) ? r.share : 'off', paused: r.paused === true };
}

/** What the new-tab page shows as "your" track. `shared` = the people you chose can currently see it. */
export type LocalNow = { track: Track; playing: boolean; shared: boolean };

/** The value under `CURRENT_KEY`: `now` and when the worker last confirmed it. The page counts a value nobody has confirmed for a while as "nothing". */
export type CurrentValue = { now: LocalNow | null; at: number };
/** Longer than the longest quiet stretch a live tab can have (a tab says something at least every minute). */
export const CURRENT_STALE_MS = 150_000;

export function parseCurrent(raw: unknown, nowMs: number): LocalNow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.at !== 'number' || nowMs - r.at > CURRENT_STALE_MS) return null;
  return parseLocalNow(r.now);
}

export function parseLocalNow(raw: unknown): LocalNow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const track = parseTrack(r.track);
  return track ? { track, playing: r.playing === true, shared: r.shared === true } : null;
}

// ── content script → service worker ──────────────────────────────────────────

/**
 * One music tab's state. Raw strings: the service worker cleans them (and works out WHICH player from the tab's own address — a
 * message can't claim to be Spotify). It carries no tab address or page title: only what the player published about its track.
 */
export type ContentReport = {
  type: 'nowplaying:report';
  playing: boolean;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  link: string;
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export function parseContentReport(raw: unknown): ContentReport | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== 'nowplaying:report') return null;
  return {
    type: 'nowplaying:report',
    playing: r.playing === true,
    title: str(r.title, 1000),
    artist: str(r.artist, 1000),
    album: str(r.album, 1000),
    artwork: str(r.artwork, 2048),
    link: str(r.link, 2048),
  };
}

// ── service worker → publisher ───────────────────────────────────────────────

export type NowPlayingHostCommand = { type: 'nowplaying-host:publish'; track: Track } | { type: 'nowplaying-host:clear' };

/** How a publish went. Only `ok` means the track is visible to the people allowed to see it. */
export type PublishResult = 'ok' | 'signed-out' | 'not-shared' | 'rate-limited' | 'unavailable' | 'error';
const RESULTS: readonly string[] = ['ok', 'signed-out', 'not-shared', 'rate-limited', 'unavailable', 'error'];
export const isPublishResult = (v: unknown): v is PublishResult => typeof v === 'string' && RESULTS.includes(v);

export function parseHostCommand(raw: unknown): NowPlayingHostCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.type === 'nowplaying-host:clear') return { type: 'nowplaying-host:clear' };
  if (r.type !== 'nowplaying-host:publish') return null;
  const track = parseTrack(r.track);
  return track ? { type: 'nowplaying-host:publish', track } : null;
}
