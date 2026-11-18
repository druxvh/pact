import { modalIsOpen, type OmniboxHost, type OmniboxIntent, summonOmnibox } from '@/lib/omnibox/focus';
import { useNavStore } from '@/store/useNavStore';
import { useUiStore } from '@/store/useUiStore';

/** The shell's view of the world for `summonOmnibox` (kept out of `lib/omnibox` so that never imports an app store). */
export const appOmniboxHost: OmniboxHost = {
  state: () => ({ paletteOpen: useUiStore.getState().paletteOpen, section: useNavStore.getState().section, modalOpen: modalIsOpen() }),
  setPaletteOpen: (open) => useUiStore.getState().setPaletteOpen(open),
};

/**
 * ⌘K and the top-bar search button: on Home focus the big search box, on every other page open the palette.
 * `toggle: false` (a button click) never closes an open palette; the keyboard shortcut does.
 */
export const openOmnibox = (opts?: { toggle?: boolean }): OmniboxIntent | null => summonOmnibox(appOmniboxHost, opts);
