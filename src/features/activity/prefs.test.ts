import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, type HomeLayout, PRESETS, type PresetId, presetLayout, presetOf, sanitizeLayout, WIDGET_IDS } from '@/features/home/layout';
import { AREAS } from '@/lib/backup/areas';
import { useSettingsStore } from '@/store/useSettingsStore';
import { activityFeedVisible } from './feedPref';

afterEach(() => useSettingsStore.setState({ activityFeed: 'auto' }));

describe('Show activity on Home', () => {
  it('is automatic by default: shown, except in the quiet layouts', () => {
    expect(useSettingsStore.getState().activityFeed).toBe('auto');
    const shown = (id: PresetId) => activityFeedVisible('auto', presetLayout(id));
    expect(shown('classic')).toBe(true);
    expect(shown('dashboard')).toBe(true);
    expect(shown('minimal')).toBe(false);
    expect(shown('zen')).toBe(false);
    expect(shown('focus')).toBe(false);
  });

  it('"on" wins over a quiet layout, "off" wins over a busy one', () => {
    for (const p of PRESETS) {
      expect(activityFeedVisible('on', p.layout), p.id).toBe(true);
      expect(activityFeedVisible('off', p.layout), p.id).toBe(false);
    }
  });

  it('a tweaked layout (custom) shows it, like Classic', () => {
    const custom: HomeLayout = { ...presetLayout('classic'), showSeconds: true };
    expect(presetOf(custom)).toBe('custom');
    expect(activityFeedVisible('auto', custom)).toBe(true);
  });

  it('is not part of the layout: presets, `presetOf` and saved layouts are exactly what they were', () => {
    expect(Object.keys(DEFAULT_LAYOUT).sort()).toEqual(['clockStyle', 'showDate', 'showHints', 'showSearch', 'showSeconds', 'showShortcuts', 'widgets']);
    for (const p of PRESETS) {
      expect(presetOf(p.layout)).toBe(p.id);
      expect(WIDGET_IDS).toEqual(expect.arrayContaining(p.layout.widgets));
      expect(Object.keys(p.layout)).not.toContain('activity');
    }
    // an old saved layout still sanitises to itself — nothing was added that it would have to carry
    const saved = { clockStyle: 'compact', showSeconds: false, showDate: true, showSearch: true, showShortcuts: false, showHints: false, widgets: [] };
    expect(sanitizeLayout(saved)).toEqual(saved);
    expect(presetOf(sanitizeLayout(saved))).toBe('minimal');
  });

  it('is a preference that is backed up and restored, and nothing else about other people is', () => {
    const area = AREAS.find((a) => a.key === 'pact-settings');
    expect(area).toBeDefined();
    const counter = { dropped: 0 } as never;
    const ok = area?.parse({ activityFeed: 'on', sounds: false }, true, counter);
    expect(ok).toMatchObject({ activityFeed: 'on', sounds: false });
    const bad = area?.parse({ activityFeed: 'maybe', sounds: false }, true, counter);
    expect(bad).not.toHaveProperty('activityFeed');
    // no activity data (notes, hearts, messages) is persisted anywhere, so no area carries it
    expect(AREAS.map((a) => a.key).filter((k) => /activity|note-feed/.test(k))).toEqual([]);
  });
});
