import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, GUEST_WIDGETS, presetLayout, presetOf, sanitizeLayout, visibleWidgets, WIDGET_IDS, WIDGET_INFO } from './layout';

describe('the main focus widget in layouts', () => {
  it('is a registered widget with a label, and leads the picker order', () => {
    expect(WIDGET_IDS[0]).toBe('mainFocus');
    expect(WIDGET_INFO.mainFocus.label).toBe('Main focus');
  });

  it('is part of the Dashboard and Focus presets, which still round-trip', () => {
    expect(presetLayout('dashboard').widgets).toContain('mainFocus');
    expect(presetLayout('focus').widgets).toContain('mainFocus');
    expect(presetOf(presetLayout('dashboard'))).toBe('dashboard');
    expect(presetOf(presetLayout('focus'))).toBe('focus');
  });

  it('is not added to the presets that are meant to be bare', () => {
    for (const id of ['classic', 'minimal', 'zen'] as const) expect(presetLayout(id).widgets).not.toContain('mainFocus');
  });

  it('a layout saved before the widget existed still reads as the preset it came from — and its Home does not change', () => {
    const oldDashboard = { ...presetLayout('dashboard'), widgets: ['today', 'focus', 'quote'] as const };
    const oldFocus = { ...presetLayout('focus'), widgets: ['today', 'focus', 'quickNote'] as const };
    expect(presetOf(sanitizeLayout(oldDashboard))).toBe('dashboard');
    expect(presetOf(sanitizeLayout(oldFocus))).toBe('focus');
    expect(sanitizeLayout(oldDashboard).widgets).toEqual(['today', 'focus', 'quote']); // not migrated behind the person's back
  });

  it('a genuinely tweaked layout is still "custom"', () => {
    expect(presetOf({ ...presetLayout('dashboard'), widgets: ['today', 'quote'] })).toBe('custom');
    expect(presetOf({ ...presetLayout('dashboard'), widgets: ['today', 'focus', 'quote'], showSeconds: true })).toBe('custom');
  });

  it('old stored layouts that never heard of it load fine; the default layout has no widgets', () => {
    expect(sanitizeLayout({ widgets: ['today', 'quote'] }).widgets).toEqual(['today', 'quote']);
    expect(DEFAULT_LAYOUT.widgets).toEqual([]);
  });
});

describe('what a guest sees', () => {
  it('is only widgets that live on this device — nothing that reads tasks, notes or the timer', () => {
    expect(GUEST_WIDGETS).toEqual(['mainFocus', 'quickNote']);
    expect(visibleWidgets(['today', 'focus', 'pinned'], false)).toEqual(['mainFocus', 'quickNote']);
    expect(visibleWidgets([], false)).toEqual(['mainFocus', 'quickNote']);
  });

  it('a signed-in person sees exactly what they chose, in their order', () => {
    expect(visibleWidgets(['quote', 'today'], true)).toEqual(['quote', 'today']);
    expect(visibleWidgets([], true)).toEqual([]);
  });

  it('returns copies, so callers can’t mutate the shared guest list', () => {
    visibleWidgets([], false).push('quote');
    expect(GUEST_WIDGETS).toEqual(['mainFocus', 'quickNote']);
  });
});
