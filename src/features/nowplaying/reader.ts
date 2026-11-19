/**
 * Reads what a music web player says it is playing — the page's own Media Session (`navigator.mediaSession`), which every player
 * sets so that media keys and the lock screen know the track. Real Chrome lets a content script's isolated world read it
 * (checked: the getters are native DOM, not page JavaScript), so there is no script injected into the page itself.
 *
 * Nothing here looks at the page's address, title or content except one best-effort lookup of the link to the track on the
 * player's own site (`trackLink`), and the media elements, only to know whether something is playing when the player doesn't
 * say. The result is raw strings; the service worker cleans and validates them.
 */
import type { ContentReport } from './protocol.ts';
import type { SourceId } from './sources.ts';

export type Snapshot = Omit<ContentReport, 'type'>;

type ArtworkLike = { src?: unknown; sizes?: unknown };
export type MediaSessionLike = {
  metadata?: { title?: unknown; artist?: unknown; album?: unknown; artwork?: ReadonlyArray<ArtworkLike> | null } | null;
  playbackState?: unknown;
};

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The area of the biggest size in a `sizes` string ("64x64 300x300"), or 0 when it says nothing usable ("any", missing). */
function area(sizes: unknown): number {
  let best = 0;
  for (const part of text(sizes).split(/\s+/)) {
    const m = /^(\d{1,5})x(\d{1,5})$/i.exec(part);
    if (m) best = Math.max(best, Number(m[1]) * Number(m[2]));
  }
  return best;
}

/**
 * The cover to show: the largest one up to 640×640 (what a card needs, without hauling a 3000 px original), or the smallest
 * larger one when every size is bigger; when none say their size, the last listed. Returned as an absolute address ('' if none).
 */
export function pickArtwork(list: ReadonlyArray<ArtworkLike> | null | undefined, base: string): string {
  const items = [...(list ?? [])].filter((a) => text(a.src));
  if (items.length === 0) return '';
  const MAX = 640 * 640;
  const sized = items.map((a) => ({ src: text(a.src), area: area(a.sizes) })).filter((a) => a.area > 0);
  let chosen: string | undefined;
  if (sized.length > 0) {
    const fits = sized.filter((a) => a.area <= MAX).sort((a, b) => b.area - a.area)[0];
    chosen = (fits ?? [...sized].sort((a, b) => a.area - b.area)[0])?.src;
  } else chosen = text(items[items.length - 1]?.src);
  if (!chosen) return '';
  try {
    return new URL(chosen, base).href;
  } catch {
    return '';
  }
}

/** Is any media element on the page actually playing? (For players that leave `playbackState` at "none".) */
function anyPlaying(doc: Document): boolean {
  return [...doc.querySelectorAll<HTMLMediaElement>('audio, video')].some((m) => !m.paused && !m.ended && m.readyState > 2);
}

/**
 * Where the player links to the track, when we know where it keeps that — best effort, and only ever a hint: the address is
 * allow-listed before it is stored or shown, and a player we don't know a selector for simply has no link.
 */
export function trackLink(source: SourceId, doc: Document, href: string): string {
  const abs = (a: Element | null) => {
    const v = a?.getAttribute('href');
    if (!v) return '';
    try {
      return new URL(v, href).href;
    } catch {
      return '';
    }
  };
  switch (source) {
    case 'spotify':
      return abs(doc.querySelector('[data-testid="now-playing-widget"] a[href*="/track/"]'));
    case 'soundcloud':
      return abs(doc.querySelector('a.playbackSoundBadge__titleLink'));
    case 'youtube-music': {
      // On the player page the address is the song's own (`/watch?v=…`); anywhere else it says nothing about the song.
      try {
        const u = new URL(href);
        const v = u.pathname === '/watch' ? u.searchParams.get('v') : null;
        return v && /^[\w-]{6,20}$/.test(v) ? `${u.origin}/watch?v=${v}` : '';
      } catch {
        return '';
      }
    }
    default:
      return '';
  }
}

export type ReadEnv = { mediaSession?: MediaSessionLike | null; doc: Document; href: string; source: SourceId };

export function readSnapshot({ mediaSession, doc, href, source }: ReadEnv): Snapshot {
  const meta = mediaSession?.metadata ?? null;
  const state = mediaSession?.playbackState;
  const playing = state === 'playing' ? true : state === 'paused' ? false : anyPlaying(doc);
  if (!meta) return { playing, title: '', artist: '', album: '', artwork: '', link: '' };
  return {
    playing,
    title: text(meta.title),
    artist: text(meta.artist),
    album: text(meta.album),
    artwork: pickArtwork(meta.artwork, href),
    link: trackLink(source, doc, href),
  };
}
