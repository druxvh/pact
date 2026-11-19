import { type HomeLayout, presetOf } from '@/features/home/layout';
import type { ActivityFeedPref } from '@/store/useSettingsStore';

/** Layouts that are deliberately sparse: the activity feed stays out of them unless it was switched on by hand. */
const SPARSE = ['minimal', 'zen', 'focus'] as const;

/**
 * Whether Home shows the Activity section. "auto" (the default) means: yes — except in the Minimal, Zen and Focus layouts, whose whole
 * point is a quiet page. "on" and "off" are the person's own choice and win over the layout. (Kept out of the layout itself, so saved
 * layouts, `presetOf` and the presets don't change.) Guests never see it — the caller checks that.
 */
export function activityFeedVisible(pref: ActivityFeedPref, layout: HomeLayout): boolean {
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  const preset = presetOf(layout);
  return !(SPARSE as readonly string[]).includes(preset);
}
