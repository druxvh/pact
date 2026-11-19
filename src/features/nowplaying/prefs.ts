/**
 * What the person chose for "Now playing", on this device:
 *
 *   detect   read the track from music tabs (needs the browser's optional permissions — asked for from a click, taken back when off)
 *   share    who may see it: nobody / my communities / everyone. This is the ACCOUNT's setting (profiles.now_playing_visibility);
 *            this is a copy of it, so the service worker never sends anything while it is "off" and a dropped connection at
 *            startup can't switch sharing off by accident
 *   paused   "pause sharing": keep showing it to me, publish nothing
 *
 * Not part of a backup (a restore can't grant browser permissions, and sharing is the account's), and wiped when another account
 * signs in on this device. sync.ts keeps the service worker and the account in step.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { syncAcrossTabs } from '@/lib/persist';
import { NowPlayingError } from './api';
import { canDetect, dropMusicAccess, requestMusicAccess } from './extension';
import { getNowPlayingApi, requireNowPlayingApi } from './hooks';
import { isVisibility, type Visibility } from './protocol';

export const NOWPLAYING_KEY = 'pact-nowplaying';

type PrefsState = {
  detect: boolean;
  share: Visibility;
  paused: boolean;
  /** One line about the last thing that didn't work (shown under the controls); cleared by the next success. */
  note: string | null;
  /** Turn detection on: asks the browser for the player pages. Call straight from a click. */
  enable(): Promise<boolean>;
  disable(): Promise<void>;
  setShare(v: Visibility): Promise<void>;
  setPaused(paused: boolean): void;
};

const explain = (err: unknown): string =>
  err instanceof NowPlayingError && err.code === 'not_signed_in'
    ? 'Sign in to share what you’re listening to.'
    : err instanceof NowPlayingError && err.code === 'network'
      ? 'Couldn’t reach the server. Check your connection and try again.'
      : 'Sharing isn’t available on this server yet.';

export const useNowPlayingPrefs = create<PrefsState>()(
  persist(
    (set) => ({
      detect: false,
      share: 'off',
      paused: false,
      note: null,

      enable() {
        // `requestMusicAccess` is called first and synchronously: the prompt needs the click's user gesture.
        const asked = requestMusicAccess();
        return asked.then((granted) => {
          if (granted) {
            set({ detect: true, note: null });
            return true;
          }
          set({
            note: canDetect
              ? 'The browser didn’t give pact access to the music sites, so nothing was turned on.'
              : 'Detecting music works in the installed pact extension, not in a plain web page.',
          });
          return false;
        });
      },

      async disable() {
        set({ detect: false, paused: false, note: null });
        await dropMusicAccess();
        try {
          await getNowPlayingApi()?.clearMine(); // belt and braces: the service worker removes it too
        } catch {
          /* it expires within two minutes */
        }
      },

      async setShare(v) {
        try {
          await requireNowPlayingApi().setVisibility(v); // the account decides; "off" also deletes the row there
          set({ share: v, note: null, ...(v === 'off' ? { paused: false } : null) });
        } catch (err) {
          set({ note: explain(err) });
        }
      },

      setPaused: (paused) => set({ paused }),
    }),
    {
      name: NOWPLAYING_KEY,
      version: 1,
      partialize: (s) => ({ detect: s.detect, share: s.share, paused: s.paused }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Record<'detect' | 'share' | 'paused', unknown>>;
        return { ...current, detect: p.detect === true, share: isVisibility(p.share) ? p.share : 'off', paused: p.paused === true };
      },
    },
  ),
);

syncAcrossTabs(NOWPLAYING_KEY, useNowPlayingPrefs);
