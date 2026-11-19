/**
 * Keeps three things in step, for the whole app (mounted once in AppShell, for guests too):
 *   • the service worker — the preference is mirrored to `storage.local` (with `share` forced to "off" when nobody is signed in);
 *   • the account — who may see the track is read from the profile when you sign in and when you come back to the page;
 *   • the browser — if the permission was taken back at chrome://extensions, the switch follows.
 * And it follows what the service worker says is playing right now (`useLocalNow`).
 */
import { useEffect } from 'react';
import { selectSignedIn, useAuthStore } from '@/store/useAuthStore';
import { canDetect, hasMusicAccess, onConfigChanged, onPermissionsChanged, writeConfig } from './extension';
import { getNowPlayingApi, useNowPlayingStore } from './hooks';
import { startLocalNowSync } from './localNow';
import { useNowPlayingPrefs } from './prefs';
import type { NowPlayingConfig } from './protocol';

const REFRESH_GAP_MS = 60_000;

/** What the service worker is told: the person's choices, but nothing is ever shared without an account. */
export function effectiveConfig(prefs: { detect: boolean; share: NowPlayingConfig['share']; paused: boolean }, signedIn: boolean): NowPlayingConfig {
  return { detect: prefs.detect, share: signedIn ? prefs.share : 'off', paused: prefs.paused };
}

/** Read who may see the track from the account (it may have been changed on another device). Quietly keeps the copy if that fails. */
export async function refreshShare(): Promise<void> {
  try {
    const share = await getNowPlayingApi()?.getVisibility();
    if (share) useNowPlayingPrefs.setState({ share });
  } catch {
    /* offline, or the database update isn't applied yet: keep what we have */
  }
}

/** Stop sharing before sign-out: the row is removed while there is still a session to remove it with. Never blocks for long. */
export async function stopSharingNow(): Promise<void> {
  await Promise.race([
    (async () => {
      try {
        await getNowPlayingApi()?.clearMine();
      } catch {
        /* expires by itself */
      }
      const { detect, paused } = useNowPlayingPrefs.getState();
      await writeConfig({ detect, share: 'off', paused });
    })(),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);
}

export function useNowPlayingSync(): void {
  const signedIn = useAuthStore(selectSignedIn);
  const userId = useAuthStore((s) => (s.status === 'signedIn' ? (s.user?.id ?? null) : null));

  // The service worker follows the preference.
  useEffect(() => {
    let last = '';
    const push = () => {
      const config = effectiveConfig(useNowPlayingPrefs.getState(), signedIn);
      const key = JSON.stringify(config);
      if (key === last) return;
      last = key;
      void writeConfig(config);
    };
    push();
    const off = useNowPlayingPrefs.subscribe(push);
    // …and the other way round: the worker found out the account isn't sharing.
    const offConfig = onConfigChanged((c) => {
      if (c.share === 'off' && useNowPlayingPrefs.getState().share !== 'off') useNowPlayingPrefs.setState({ share: 'off' });
    });
    return () => {
      off();
      offConfig();
    };
  }, [signedIn]);

  // The browser permission is the truth: if it is gone, so is "detect".
  useEffect(() => {
    if (!canDetect) return;
    let live = true;
    const check = () =>
      void hasMusicAccess().then((granted) => {
        if (live && !granted && useNowPlayingPrefs.getState().detect) useNowPlayingPrefs.setState({ detect: false });
      });
    check();
    const off = onPermissionsChanged(check);
    return () => {
      live = false;
      off();
    };
  }, []);

  // What is playing here.
  useEffect(() => startLocalNowSync(), []);

  // The account's setting.
  useEffect(() => {
    if (!userId) return;
    void refreshShare();
    let at = Date.now();
    const back = () => {
      if (document.visibilityState === 'visible' && Date.now() - at >= REFRESH_GAP_MS) {
        at = Date.now();
        void refreshShare();
      }
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [userId]);

  // Other people's tracks: start over when the account changes (and look up whoever is on screen with the new account).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `userId` is the trigger, not a value the effect reads
  useEffect(() => {
    useNowPlayingStore.getState().reset();
  }, [userId]);
}
