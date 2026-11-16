import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  daysUntil,
  moveWidget,
  orderedWidgets,
  PRESETS,
  presetLayout,
  presetOf,
  sanitizeCountdown,
  sanitizeLayout,
  toggleWidget,
  WIDGET_IDS,
} from './layout';

describe('presets', () => {
  it('are distinct, valid, and each round-trips through presetOf', () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    for (const p of PRESETS) {
      expect(sanitizeLayout(p.layout)).toEqual(p.layout); // already valid
      expect(presetOf(presetLayout(p.id))).toBe(p.id);
    }
    // no two presets are the same layout, or presetOf would be ambiguous
    expect(new Set(PRESETS.map((p) => JSON.stringify(p.layout))).size).toBe(PRESETS.length);
  });

  it('the default is Classic', () => {
    expect(presetOf(DEFAULT_LAYOUT)).toBe('classic');
  });

  it('any tweak turns a preset into "custom"; undoing it goes back', () => {
    const l = presetLayout('classic');
    expect(presetOf({ ...l, showSeconds: true })).toBe('custom');
    expect(presetOf({ ...l, widgets: ['quote'] })).toBe('custom');
    expect(presetOf({ ...l, showSeconds: false })).toBe('classic');
  });

  it('widget order matters for matching', () => {
    const d = presetLayout('dashboard');
    expect(presetOf({ ...d, widgets: [...d.widgets].reverse() })).toBe('custom');
  });

  it('presetLayout returns a copy (mutating it cannot corrupt the preset)', () => {
    const a = presetLayout('dashboard');
    a.widgets.push('pinned');
    expect(presetLayout('dashboard').widgets).not.toContain('pinned');
  });
});

describe('sanitizeLayout', () => {
  it('falls back to the default for junk', () => {
    for (const junk of [null, undefined, 5, 'x', [], {}]) expect(sanitizeLayout(junk)).toEqual(DEFAULT_LAYOUT);
  });
  it('keeps valid values and drops invalid ones', () => {
    const out = sanitizeLayout({ clockStyle: 'analog', showSeconds: 'yes', showDate: false, widgets: ['quote', 'nope', 'today', 'quote', 7] });
    expect(out.clockStyle).toBe('analog');
    expect(out.showSeconds).toBe(DEFAULT_LAYOUT.showSeconds); // wrong type → default
    expect(out.showDate).toBe(false);
    expect(out.widgets).toEqual(['quote', 'today']); // unknown + duplicate dropped, order kept
  });
  it('rejects an unknown clock style', () => {
    expect(sanitizeLayout({ clockStyle: 'roman' }).clockStyle).toBe(DEFAULT_LAYOUT.clockStyle);
  });
});

describe('widget list helpers', () => {
  it('toggle appends when turning on and removes when turning off', () => {
    expect(toggleWidget(['quote'], 'today')).toEqual(['quote', 'today']);
    expect(toggleWidget(['quote', 'today'], 'quote')).toEqual(['today']);
  });
  it('move swaps with the neighbour and is a no-op at the ends / when off', () => {
    const w = ['today', 'focus', 'quote'] as const;
    expect(moveWidget(w, 'focus', -1)).toEqual(['focus', 'today', 'quote']);
    expect(moveWidget(w, 'focus', 1)).toEqual(['today', 'quote', 'focus']);
    expect(moveWidget(w, 'today', -1)).toEqual([...w]);
    expect(moveWidget(w, 'quote', 1)).toEqual([...w]);
    expect(moveWidget(w, 'pinned', 1)).toEqual([...w]);
  });
  it('orderedWidgets lists enabled first (in order) then the rest, each exactly once', () => {
    const out = orderedWidgets(['quote', 'today']);
    expect(out.slice(0, 2)).toEqual(['quote', 'today']);
    expect([...out].sort()).toEqual([...WIDGET_IDS].sort());
  });
});

describe('daysUntil', () => {
  const now = new Date(2026, 10, 16, 23, 59); // 16 Nov 2026, late evening
  it('counts calendar days, ignoring the time of day', () => {
    expect(daysUntil('2026-11-16', now)).toBe(0);
    expect(daysUntil('2026-11-17', now)).toBe(1);
    expect(daysUntil('2026-11-15', now)).toBe(-1);
    expect(daysUntil('2026-12-25', now)).toBe(39);
    expect(daysUntil('2027-11-16', now)).toBe(365);
  });
  it('is not thrown off by daylight-saving changes', () => {
    expect(daysUntil('2026-03-30', new Date(2026, 2, 28, 12))).toBe(2); // spans the EU/US spring-forward weekend
    expect(daysUntil('2026-11-02', new Date(2026, 9, 30, 12))).toBe(3); // spans the autumn change
  });
  it('rejects malformed and impossible dates', () => {
    for (const bad of [null, '', '2026-1-1', 'tomorrow', '2026-02-30', '2026-13-01']) expect(daysUntil(bad, now)).toBeNull();
  });
});

describe('sanitizeCountdown', () => {
  it('trims over-long titles and drops invalid dates', () => {
    expect(sanitizeCountdown({ title: 'x'.repeat(90), date: '2026-12-25' })).toEqual({ title: 'x'.repeat(40), date: '2026-12-25' });
    expect(sanitizeCountdown({ title: 5, date: '2026-02-31' })).toEqual({ title: '', date: null });
    expect(sanitizeCountdown(null)).toEqual({ title: '', date: null });
  });
});
