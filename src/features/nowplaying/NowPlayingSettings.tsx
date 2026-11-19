import { Segmented, Switch } from '@/components/ui';
import { SettingsRow } from '@/features/settings/ui';
import { selectSignedIn, useAuthStore } from '@/store/useAuthStore';
import { canDetect } from './extension';
import { useNowPlayingPrefs } from './prefs';
import type { Visibility } from './protocol';
import { MUSIC_PAGE_HOSTS } from './sources';

const OPTIONS: ReadonlyArray<{ value: Visibility; label: string }> = [
  { value: 'off', label: 'Nobody' },
  { value: 'communities', label: 'My communities' },
  { value: 'everyone', label: 'Everyone' },
];

const SHARE_NOTE: Record<Visibility, string> = {
  off: 'Only you see it, on Home.',
  communities: 'People who share a community with you see it on your avatar and profile card.',
  everyone: 'Everyone who uses pact can see it on your avatar and profile card.',
};

/**
 * The "Now playing" controls, as three rows of the Profile section: detect (needs the browser's permission, asked for when the
 * switch is flipped), who sees it, and a quick pause. They sit in the same bordered list as the profile form (a fragment, so
 * each row is a direct child and gets its hairline).
 */
export function NowPlayingSettings() {
  const detect = useNowPlayingPrefs((s) => s.detect);
  const share = useNowPlayingPrefs((s) => s.share);
  const paused = useNowPlayingPrefs((s) => s.paused);
  const note = useNowPlayingPrefs((s) => s.note);
  const enable = useNowPlayingPrefs((s) => s.enable);
  const disable = useNowPlayingPrefs((s) => s.disable);
  const setShare = useNowPlayingPrefs((s) => s.setShare);
  const setPaused = useNowPlayingPrefs((s) => s.setPaused);
  const signedIn = useAuthStore(selectSignedIn);

  return (
    <>
      <SettingsRow
        label="Detect music in this browser"
        htmlFor="set-np-detect"
        description={
          <>
            Shows what you’re playing on Home. When you turn this on, your browser asks to let pact read music tabs on {MUSIC_PAGE_HOSTS.join(', ')} — only the
            track title, artist, album and cover. Nothing else on those pages, and no other sites. Turn it off to take the access back.
            {!canDetect && ' (Works in the installed extension, not in a web page.)'}
          </>
        }
      >
        <Switch
          id="set-np-detect"
          checked={detect}
          disabled={!canDetect && !detect}
          onCheckedChange={(on) => void (on ? enable() : disable())}
          aria-label="Detect music in this browser"
        />
      </SettingsRow>
      <SettingsRow
        label="Share with"
        description={signedIn ? SHARE_NOTE[share] : 'Sign in to share what you’re listening to. Without an account it stays on this device.'}
      >
        <Segmented
          size="sm"
          aria-label="Share what I’m listening to with"
          value={share}
          disabled={!signedIn}
          onValueChange={(v) => void setShare(v)}
          options={OPTIONS}
        />
      </SettingsRow>
      <SettingsRow
        label="Pause sharing"
        htmlFor="set-np-pause"
        description={
          detect && signedIn && share !== 'off'
            ? 'Stops sharing right now and removes your track. Home still shows it to you. Also on the Now playing widget.'
            : 'Available once detecting is on and you share with someone.'
        }
      >
        <Switch id="set-np-pause" checked={paused} disabled={!detect || !signedIn || share === 'off'} onCheckedChange={setPaused} aria-label="Pause sharing" />
      </SettingsRow>
      {note && (
        <p role="status" className="py-2 text-xs leading-snug text-destructive-text">
          {note}
        </p>
      )}
    </>
  );
}
