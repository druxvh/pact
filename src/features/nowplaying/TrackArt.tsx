import { Music2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { hueFrom } from '@/lib/format';
import { type SourceId, safeArtworkUrl } from './sources';
import type { Track } from './track';

/** Each player's own colour family, so a song without a picture still looks like it came from there (Spotify green, YouTube red…). */
const SOURCE_HUE: Record<SourceId, number> = { spotify: 152, 'youtube-music': 25, soundcloud: 48, 'apple-music': 350, deezer: 290, tidal: 225 };

/** The generated cover: a gradient in the player's colour (shifted a little per title so two songs don't look identical) and a soft highlight. */
export function coverBackground(track: Pick<Track, 'source' | 'title'>): string {
  const hue = (SOURCE_HUE[track.source] ?? hueFrom(track.title)) + (hueFrom(track.title || '?') % 31) - 15;
  return [
    'radial-gradient(circle at 24% 18%, oklch(1 0 0 / 0.26), transparent 58%)',
    `linear-gradient(135deg, oklch(0.62 0.16 ${hue}), oklch(0.42 0.14 ${(hue + 38) % 360}))`,
  ].join(', ');
}

/**
 * A track's cover. The address is allow-listed here AGAIN (sources.ts) — this is the last stop before an `<img src>`, and an
 * artwork address chosen by someone else would let them log the IP of whoever looks. No Referer is sent.
 *
 * It is never a blank box: underneath the picture there is always a generated cover (the player's colours + a music note), which is
 * what shows while the picture loads, when there is none, and when it can't be loaded.
 */
export function TrackArt({ track, size = 40, className }: { track: Track; size?: number; className?: string }) {
  const url = safeArtworkUrl(track.artworkUrl, track.source);
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const showing = url !== null && failed !== url;
  return (
    <span
      aria-hidden="true"
      data-track-art=""
      className={cn(
        'relative grid shrink-0 select-none place-items-center overflow-hidden text-white shadow-xs',
        size >= 64 ? 'rounded-lg' : 'rounded-md',
        className,
      )}
      style={{ width: size, height: size, background: coverBackground(track) }}
    >
      {/* under the picture until it has loaded (so it is never blank), and gone after — a picture blended by a style must not show it through */}
      {!(showing && loaded === url) && <Music2 className="size-[42%] opacity-80 drop-shadow-sm" strokeWidth={2} />}
      {showing && (
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          draggable={false}
          ref={(el) => {
            if (el?.complete && el.naturalWidth > 0) setLoaded(url);
          }}
          onLoad={() => setLoaded(url)}
          onError={() => setFailed(url)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  );
}
