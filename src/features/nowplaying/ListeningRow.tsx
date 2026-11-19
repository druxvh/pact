import { ArrowUpRight } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { cn } from '@/lib/cn';
import { Equalizer } from './Equalizer';
import { safeTrackUrl, sourceLabel } from './sources';
import { TrackArt } from './TrackArt';
import { parseTrack, type Track } from './track';

/**
 * The "Listening now" row on a profile card and in the feed: a large cover, title, artist · player, moving bars — a link to the track
 * when we have an address on the player's own site. Another person's data: it is re-cleaned here (text only, capped, invisible
 * characters stripped), and the address is allow-listed again, so nothing reaches the page that the database and the store didn't
 * already vet.
 *
 * `actions` (a heart, a comment button…) sit under the song, OUTSIDE the link — a button can't live inside an anchor. `size` "sm"
 * is the old compact row (a 40 px cover), "md" a 64 px one, "lg" (the default) the big cover. `live={false}` is for a song someone
 * pinned to a note: no moving bars, and `label` says what it is.
 */
export function ListeningRow({
  track,
  className,
  actions,
  size = 'lg',
  label = 'Listening now',
  live = true,
}: {
  track: Track;
  className?: string;
  actions?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  live?: boolean;
}) {
  const t = useMemo(() => parseTrack(track), [track]);
  if (!t) return null;
  const href = safeTrackUrl(t.trackUrl, t.source);
  const player = sourceLabel(t.source);
  const big = size !== 'sm';
  const body = (
    <>
      <TrackArt track={t} size={size === 'lg' ? 84 : size === 'md' ? 64 : 40} />
      <span className="min-w-0 flex-1">
        <span
          className={cn('flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide', live ? 'text-brand-text' : 'text-subtle-foreground')}
        >
          {live && <Equalizer size="xs" />}
          {label}
        </span>
        <span className={cn('block font-medium leading-tight', big ? 'mt-0.5 line-clamp-2 break-words text-[14px]' : 'truncate text-[13px]')}>{t.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{t.artist ? `${t.artist} · ${player}` : player}</span>
      </span>
      {href && <ArrowUpRight className="size-3.5 shrink-0 self-start text-muted-foreground" aria-hidden="true" />}
    </>
  );
  const row = cn('flex items-center', big ? 'gap-3' : 'gap-2.5');
  return (
    <div className={cn('rounded-lg border bg-muted/40 p-2', className)}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          title={`Open on ${player}`}
          className={cn(row, '-m-1 rounded-md p-1 transition-colors hover:bg-accent')}
        >
          {body}
        </a>
      ) : (
        <div className={row}>{body}</div>
      )}
      {actions && <div className="mt-1.5 flex items-center gap-1 border-t border-border/60 pt-1.5">{actions}</div>}
    </div>
  );
}
