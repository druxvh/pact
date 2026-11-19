import { Headphones, Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui';
import { OpenLink, WidgetCard, WidgetEmpty } from '@/features/home/widgets/WidgetCard';
import { cn } from '@/lib/cn';
import { selectSignedIn, useAuthStore } from '@/store/useAuthStore';
import { useNavStore } from '@/store/useNavStore';
import { Equalizer } from './Equalizer';
import { useLocalNow } from './localNow';
import { useNowPlayingPrefs } from './prefs';
import { SOURCE_IDS, sourceLabel } from './sources';
import { TrackArt } from './TrackArt';

const VISIBILITY_LABEL = { off: 'Nobody', communities: 'my communities', everyone: 'everyone' } as const;
const NAMES = SOURCE_IDS.map(sourceLabel);
/** "Spotify, YouTube Music, … or Tidal" */
const PLAYERS = `${NAMES.slice(0, -1).join(', ')} or ${NAMES.at(-1)}`;

/**
 * Home widget: what YOU are listening to, from a music tab open in this browser. On this device it works for guests too; sharing it
 * needs an account. Off by default — the empty state explains what is read and has the switch.
 */
export function NowPlayingWidget() {
  const detect = useNowPlayingPrefs((s) => s.detect);
  const share = useNowPlayingPrefs((s) => s.share);
  const paused = useNowPlayingPrefs((s) => s.paused);
  const note = useNowPlayingPrefs((s) => s.note);
  const enable = useNowPlayingPrefs((s) => s.enable);
  const setPaused = useNowPlayingPrefs((s) => s.setPaused);
  const signedIn = useAuthStore(selectSignedIn);
  const go = useNavStore((s) => s.go);
  const local = useLocalNow();

  if (!detect) {
    return (
      <WidgetCard icon={Headphones} title="Now playing">
        <WidgetEmpty
          action={
            <div className="flex flex-col items-start gap-1.5">
              <Button variant="primary" size="sm" onClick={() => void enable()}>
                Turn on
              </Button>
              {note && (
                <p role="status" className="text-xs leading-snug text-muted-foreground">
                  {note}
                </p>
              )}
            </div>
          }
        >
          Shows the song playing in a music tab — {PLAYERS}. Only the track name, artist and cover are read, and nothing leaves this device unless you choose to
          share it.
        </WidgetEmpty>
      </WidgetCard>
    );
  }

  const track = local?.track;
  const playing = local?.playing ?? false;
  const sharing = signedIn && share !== 'off';

  return (
    <WidgetCard icon={Headphones} title="Now playing" action={<OpenLink to="settings" label="Settings" />}>
      {track ? (
        <div className="flex flex-1 flex-col justify-between gap-3">
          <div className="flex items-center gap-3">
            <TrackArt track={track} size={72} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold leading-tight tracking-tight">{track.title}</p>
              <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{track.artist || track.album || sourceLabel(track.source)}</p>
              <p className={cn('mt-1 flex items-center gap-1.5 text-xs', playing ? 'text-brand-text' : 'text-subtle-foreground')}>
                <Equalizer size="xs" playing={playing} />
                {playing ? 'Playing' : 'Paused'} · {sourceLabel(track.source)}
              </p>
            </div>
          </div>
          <div className="flex min-h-7 items-center justify-between gap-2">
            <p className="min-w-0 text-xs leading-snug text-muted-foreground">
              {!signedIn
                ? 'Only on this device. Sign in to share it.'
                : share === 'off'
                  ? 'Only you can see this.'
                  : paused
                    ? 'Sharing is paused.'
                    : `Shared with ${VISIBILITY_LABEL[share]}.`}
            </p>
            {signedIn &&
              (share === 'off' ? (
                <Button variant="ghost" size="xs" onClick={() => go('settings')}>
                  Share…
                </Button>
              ) : (
                <Button variant="soft" size="xs" onClick={() => setPaused(!paused)} aria-pressed={paused}>
                  {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                  {paused ? 'Resume sharing' : 'Pause sharing'}
                </Button>
              ))}
          </div>
        </div>
      ) : (
        <WidgetEmpty>
          Nothing playing. Play something in {PLAYERS} and it shows up here{sharing && !paused ? ' — and for the people you share with' : ''}.
        </WidgetEmpty>
      )}
    </WidgetCard>
  );
}
