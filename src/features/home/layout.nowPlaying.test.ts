import { describe, expect, it } from 'vitest';
import { GUEST_WIDGETS, PRESETS, presetLayout, presetOf, sanitizeLayout, visibleWidgets, WIDGET_IDS, WIDGET_INFO } from './layout';

describe('the Now playing widget in layouts', () => {
  it('is a registered widget with a label and a description', () => {
    expect(WIDGET_IDS).toContain('nowPlaying');
    expect(WIDGET_INFO.nowPlaying.label).toBe('Now playing');
    expect(WIDGET_INFO.nowPlaying.description.length).toBeGreaterThan(10);
    // every widget id has its info, and none is listed twice
    expect(new Set(WIDGET_IDS).size).toBe(WIDGET_IDS.length);
    for (const id of WIDGET_IDS) expect(WIDGET_INFO[id], id).toBeDefined();
  });

  it('is part of the Dashboard preset only — the other presets stay as they were', () => {
    expect(presetLayout('dashboard').widgets).toEqual(['mainFocus', 'today', 'focus', 'nowPlaying', 'quote']);
    for (const p of PRESETS) if (p.id !== 'dashboard') expect(p.layout.widgets, p.id).not.toContain('nowPlaying');
    expect(presetOf(presetLayout('dashboard'))).toBe('dashboard');
  });

  it('a Dashboard saved before the widget existed still reads as the Dashboard — in both of its earlier forms — and does not change', () => {
    const before = presetLayout('dashboard');
    const withoutMainFocus = { ...before, widgets: ['today', 'focus', 'quote'] };
    const withMainFocus = { ...before, widgets: ['mainFocus', 'today', 'focus', 'quote'] };
    expect(presetOf(sanitizeLayout(withoutMainFocus))).toBe('dashboard');
    expect(presetOf(sanitizeLayout(withMainFocus))).toBe('dashboard');
    expect(sanitizeLayout(withMainFocus).widgets).toEqual(['mainFocus', 'today', 'focus', 'quote']); // not migrated behind the person's back
  });

  it('the Focus preset still matches its earlier form, and a tweaked Dashboard is "custom"', () => {
    expect(presetOf({ ...presetLayout('focus'), widgets: ['today', 'focus', 'quickNote'] })).toBe('focus');
    expect(presetOf({ ...presetLayout('dashboard'), widgets: ['mainFocus', 'today', 'focus', 'nowPlaying'] })).toBe('custom');
    expect(presetOf({ ...presetLayout('dashboard'), widgets: ['mainFocus', 'today', 'nowPlaying', 'focus', 'quote'] })).toBe('custom');
  });

  it('a stored layout may list it; unknown ids are still dropped', () => {
    expect(sanitizeLayout({ widgets: ['nowPlaying', 'nope', 'quote'] }).widgets).toEqual(['nowPlaying', 'quote']);
  });

  it('guests get it, because it lives on this device (sharing is what needs an account) — whatever their layout says', () => {
    expect(GUEST_WIDGETS).toContain('nowPlaying');
    expect(visibleWidgets([], false)).toContain('nowPlaying');
    expect(visibleWidgets(['today'], true)).toEqual(['today']); // a signed-in person only sees what they chose
  });
});
