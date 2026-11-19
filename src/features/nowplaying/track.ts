/**
 * What "a track" is, and the one place a track from anywhere — a content script, the database, another person's browser — is
 * cleaned before anything uses it. Treat all of it as hostile: other people's titles are shown as TEXT only (React escapes them;
 * nothing here ever becomes HTML), control / invisible / bidi characters are stripped, lengths are capped, and addresses go
 * through the allow-list in sources.ts.
 *
 * The caps and the invisible-character set match the database's check constraints (see the migration).
 */
import { isSourceId, type SourceId, safeArtworkUrl, safeTrackUrl } from './sources.ts';

export const TEXT_MAX = 150;

export type Track = {
  title: string;
  artist: string;
  album: string;
  /** Already on the player's own image host (or null) — see `safeArtworkUrl`. */
  artworkUrl: string | null;
  /** Already on the player's own site (or null). */
  trackUrl: string | null;
  source: SourceId;
};

// Control characters, zero-width characters and bidi overrides (the last kind lets a title render as something it is not).
// Built from code points rather than a regex literal so no invisible character lives in this file.
const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x1f], // C0 controls (newline and tab included — they collapse to spaces)
  [0x7f, 0x9f], // DEL + C1 controls
  [0x200b, 0x200f], // zero-width space/joiners, LRM/RLM
  [0x2028, 0x202e], // line / paragraph separators, bidi embeddings and overrides
  [0x2060, 0x2069], // word joiner, invisible operators, bidi isolates
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
];
const INVISIBLE = new RegExp(`[${INVISIBLE_RANGES.map(([a, b]) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`).join('')}]`, 'g');

/** Plain single-line text: invisible characters become spaces, runs of whitespace collapse, at most `max` code points (never half an emoji). */
export function cleanText(v: unknown, max = TEXT_MAX): string {
  if (typeof v !== 'string') return '';
  const s = v.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : Array.from(s).slice(0, max).join('').trim();
}

/**
 * A clean track, or null when there is nothing worth showing (no title). `source` is NOT taken from `raw`: the caller knows which
 * player it came from (the service worker works it out from the tab's address; the database row has its own column).
 */
export function cleanTrack(raw: unknown, source: SourceId): Track | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const title = cleanText(r.title);
  if (!title) return null;
  return {
    title,
    artist: cleanText(r.artist),
    album: cleanText(r.album),
    artworkUrl: safeArtworkUrl(r.artworkUrl, source),
    trackUrl: safeTrackUrl(r.trackUrl, source),
    source,
  };
}

/** A track already in our shape (from storage, a message, a store) — re-validated, because the shape says nothing about what is in it. */
export function parseTrack(raw: unknown): Track | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = (raw as { source?: unknown }).source;
  return isSourceId(source) ? cleanTrack(raw, source) : null;
}

/** A row of `public.now_playing` (snake_case, from the API or a Realtime event). */
export function trackFromRow(row: unknown): Track | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  return isSourceId(r.source)
    ? cleanTrack({ title: r.title, artist: r.artist, album: r.album, artworkUrl: r.artwork_url, trackUrl: r.track_url }, r.source)
    : null;
}

export const sameTrack = (a: Track | null, b: Track | null): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.source === b.source &&
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.artworkUrl === b.artworkUrl &&
    a.trackUrl === b.trackUrl);
