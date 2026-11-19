/**
 * The music players pact can read, and the ONE allow-list every address that comes from one of them must pass.
 *
 * Why so strict: a track's title, artwork and link are typed by someone else's browser, and shown to other people. A free-form
 * artwork address would let one person log the IP address of everyone who opens their profile card, and a free-form link would
 * make "listening now" a way to hand out links. So an address is only ever accepted when it is https (no credentials, no odd
 * port) and its host is one of the player's OWN hosts — exactly, or as a real subdomain (`i.scdn.co` for `scdn.co`; never
 * `scdn.co.evil.example`, never `evil.example/scdn.co`). supabase/migrations/20261119100000_now_playing.sql holds the same lists
 * (a test compares them) and the database refuses anything else; this module checks again before an address reaches an
 * `<img>` or an `<a>`.
 *
 * Dependency-free with explicit `.ts` import specifiers: it runs in the content script, the service worker, the offscreen page,
 * the new-tab page and in tests (and wxt.config.ts reads the page hosts from it).
 */

export const SOURCE_IDS = ['spotify', 'youtube-music', 'soundcloud', 'apple-music', 'deezer', 'tidal'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export type SourceInfo = {
  label: string;
  /** The web player's own page (exact host — the permission and the content script are asked for exactly these). */
  pageHosts: readonly string[];
  /** Hosts a link to a track may be on (each also matches its subdomains). */
  trackHosts: readonly string[];
  /** Hosts the player serves cover art from (each also matches its subdomains). */
  artworkHosts: readonly string[];
};

export const SOURCES: Readonly<Record<SourceId, SourceInfo>> = {
  spotify: { label: 'Spotify', pageHosts: ['open.spotify.com'], trackHosts: ['open.spotify.com'], artworkHosts: ['scdn.co', 'spotifycdn.com'] },
  'youtube-music': {
    label: 'YouTube Music',
    pageHosts: ['music.youtube.com'],
    trackHosts: ['music.youtube.com'],
    artworkHosts: ['googleusercontent.com', 'ytimg.com', 'ggpht.com'],
  },
  soundcloud: { label: 'SoundCloud', pageHosts: ['soundcloud.com'], trackHosts: ['soundcloud.com'], artworkHosts: ['sndcdn.com'] },
  'apple-music': { label: 'Apple Music', pageHosts: ['music.apple.com'], trackHosts: ['music.apple.com'], artworkHosts: ['mzstatic.com'] },
  deezer: { label: 'Deezer', pageHosts: ['www.deezer.com'], trackHosts: ['deezer.com'], artworkHosts: ['dzcdn.net'] },
  tidal: { label: 'Tidal', pageHosts: ['tidal.com'], trackHosts: ['tidal.com'], artworkHosts: ['tidal.com'] },
};

export const isSourceId = (v: unknown): v is SourceId => typeof v === 'string' && (SOURCE_IDS as readonly string[]).includes(v);

export const sourceLabel = (id: SourceId): string => SOURCES[id].label;

/** Every page the content script may run on, as match patterns (also what the optional host permissions are). */
export const MUSIC_MATCH_PATTERNS: readonly string[] = SOURCE_IDS.flatMap((id) => SOURCES[id].pageHosts.map((h) => `https://${h}/*`));

/** The hostnames behind `MUSIC_MATCH_PATTERNS`, for the privacy policy and the Settings explanation. */
export const MUSIC_PAGE_HOSTS: readonly string[] = SOURCE_IDS.flatMap((id) => SOURCES[id].pageHosts);

/** Which player a page host belongs to (exact host, as the permission is). Anything else is not a music player: null. */
export function sourceForHost(hostname: string): SourceId | null {
  const host = hostname.toLowerCase();
  return SOURCE_IDS.find((id) => SOURCES[id].pageHosts.includes(host)) ?? null;
}

/** Which player a tab's address belongs to — https only. A page that isn't a recognised player is null, and nothing about it goes any further. */
export function sourceForUrl(url: unknown): SourceId | null {
  if (typeof url !== 'string' || url.length > 2048) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? sourceForHost(u.hostname) : null;
  } catch {
    return null;
  }
}

/** `host` is `allowed` or a subdomain of it. Compares whole labels, so `notscdn.co` and `scdn.co.evil.example` are not `scdn.co`. */
export function hostMatches(host: string, allowed: string): boolean {
  const h = host.toLowerCase();
  const a = allowed.toLowerCase();
  return h === a || h.endsWith(`.${a}`);
}

export const URL_MAX = 500;
// Anything a person (or a script) shouldn't be able to smuggle into an address: whitespace and control characters.
const BAD_IN_URL = /[\s\p{Cc}]/u;

/**
 * The canonical form of `raw` if it is an https address on one of `allowed` hosts, else null. No credentials, no port other
 * than 443, no whitespace, at most 500 characters. A relative address, `javascript:`, `data:` and `blob:` are all null.
 */
export function safeHttpsUrl(raw: unknown, allowed: readonly string[]): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > URL_MAX || BAD_IN_URL.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port !== '' && url.port !== '443')) return null;
  if (!allowed.some((a) => hostMatches(url.hostname, a))) return null;
  return url.href.length <= URL_MAX ? url.href : null;
}

/** Cover art: only from the player's own image hosts. This is the check that stands between a track's data and an `<img src>`. */
export const safeArtworkUrl = (raw: unknown, source: SourceId): string | null => safeHttpsUrl(raw, SOURCES[source].artworkHosts);

/** A link to the track on the player's own site. */
export const safeTrackUrl = (raw: unknown, source: SourceId): string | null => safeHttpsUrl(raw, SOURCES[source].trackHosts);
