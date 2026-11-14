import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { syncAcrossTabs } from '@/lib/persist';

export type ClockFormat = 'auto' | '12h' | '24h';
/** How animations behave: follow the OS preference, always on, or minimised. */
export type MotionPreference = 'system' | 'full' | 'reduced';

export type SettingsState = {
  clock: ClockFormat;
  showGreeting: boolean;
  /** Show Chrome's most-visited sites on Home (needs the topSites permission). */
  showTopSites: boolean;
  sounds: boolean;
  motion: MotionPreference;
  set: <K extends keyof Omit<SettingsState, 'set'>>(key: K, value: SettingsState[K]) => void;
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      clock: 'auto',
      showGreeting: true,
      showTopSites: true,
      sounds: true,
      motion: 'system',
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
    }),
    { name: 'pact-settings', version: 1 },
  ),
);

syncAcrossTabs('pact-settings', useSettingsStore);
