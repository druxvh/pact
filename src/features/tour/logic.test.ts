import { describe, expect, it } from 'vitest';
import {
  type AutoStartInput,
  type Box,
  decideAutoStart,
  isUsable,
  looksLikeFreshInstall,
  placeCard,
  sameBox,
  spotlightBox,
  type TourContext,
  tourSteps,
} from './logic';

const ctx: TourContext = { mod: '⌘', captureKeys: ['⇧', '⌘', 'Y'] };
const desktop = { width: 1280, height: 800 };
const phone = { width: 375, height: 667 };
const card = { width: 352, height: 240 };

describe('tourSteps', () => {
  it('the signed-in tour points at the real UI: sections, palette, capture, focus timer, settings', () => {
    const steps = tourSteps('full', ctx);
    expect(steps.map((s) => s.id)).toEqual(['sections', 'palette', 'capture', 'focus', 'settings']);
    expect(steps.map((s) => s.target)).toEqual(['sections', 'palette', null, 'nav-timer', 'nav-settings']);
  });

  it('the guest tour only mentions what a guest can see: no Focus or Settings, but a way to sign in', () => {
    const steps = tourSteps('guest', ctx);
    expect(steps.map((s) => s.id)).toEqual(['palette', 'capture', 'sections', 'sign-in']);
    const targets = steps.map((s) => s.target);
    expect(targets).not.toContain('nav-timer');
    expect(targets).not.toContain('nav-settings');
    expect(targets).toContain('sign-in');
  });

  it('every step has a title and a body, ids are unique, and key hints are never empty', () => {
    for (const kind of ['full', 'guest'] as const) {
      const steps = tourSteps(kind, ctx);
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
      for (const s of steps) {
        expect(s.title.length).toBeGreaterThan(3);
        expect(s.body.length).toBeGreaterThan(10);
        for (const k of s.keys ?? []) expect(k.keys.length).toBeGreaterThan(0);
      }
    }
  });

  it('shows the platform’s modifier and the real capture shortcut', () => {
    const palette = tourSteps('full', { mod: 'Ctrl', captureKeys: ['Alt', 'Shift', 'N'] });
    expect(palette.find((s) => s.id === 'palette')?.keys?.[0]?.keys).toEqual(['Ctrl', 'K']);
    expect(palette.find((s) => s.id === 'capture')?.keys?.[1]?.keys).toEqual(['Alt', 'Shift', 'N']);
  });
});

describe('isUsable', () => {
  it('rejects hidden (0×0) and off-screen elements', () => {
    expect(isUsable(null, desktop)).toBe(false);
    expect(isUsable({ top: 10, left: 10, width: 0, height: 20 }, desktop)).toBe(false);
    expect(isUsable({ top: 10, left: 10, width: 20, height: 0 }, desktop)).toBe(false);
    expect(isUsable({ top: -100, left: 0, width: 50, height: 50 }, desktop)).toBe(false);
    expect(isUsable({ top: 900, left: 0, width: 50, height: 50 }, desktop)).toBe(false);
    expect(isUsable({ top: 10, left: 10, width: 50, height: 50 }, desktop)).toBe(true);
    expect(isUsable({ top: -10, left: 10, width: 50, height: 50 }, desktop)).toBe(true); // partly visible
  });
});

describe('placeCard', () => {
  const rail: Box = { top: 70, left: 0, width: 68, height: 500 };
  const searchBtn: Box = { top: 8, left: 1200, width: 32, height: 32 };

  it('uses the preferred side when it fits, centred on the target and kept inside the screen', () => {
    const p = placeCard(rail, card, desktop, 'right');
    expect(p.side).toBe('right');
    expect(p.left).toBe(68 + 14);
    expect(p.top).toBeGreaterThanOrEqual(12);
    expect(p.top + card.height).toBeLessThanOrEqual(desktop.height - 12);
  });

  it('flips to the other side when there is no room, and never leaves the viewport', () => {
    const p = placeCard(searchBtn, card, desktop, 'bottom');
    expect(p.side).toBe('bottom');
    expect(p.left + card.width).toBeLessThanOrEqual(desktop.width - 12); // slid left so it doesn't overflow the right edge
    const flipped = placeCard({ top: 700, left: 500, width: 100, height: 40 }, card, desktop, 'bottom');
    expect(flipped.side).toBe('top');
    expect(flipped.top + card.height).toBeLessThanOrEqual(700);
  });

  it('is centred when there is nothing to point at, or the target is hidden', () => {
    for (const anchor of [null, { top: 0, left: 0, width: 0, height: 0 }]) {
      const p = placeCard(anchor, card, desktop, 'right');
      expect(p.side).toBe('center');
      expect(p.left).toBe((desktop.width - card.width) / 2);
      expect(p.top).toBe((desktop.height - card.height) / 2);
    }
  });

  it('works on a phone: a bottom tab bar gets a card above it, and nothing hangs off the edge', () => {
    const tabs: Box = { top: 611, left: 0, width: 375, height: 56 };
    const small = { width: 340, height: 230 };
    const p = placeCard(tabs, small, phone, 'right');
    expect(p.side).toBe('top');
    expect(p.top + small.height).toBeLessThanOrEqual(611);
    expect(p.left).toBeGreaterThanOrEqual(12);
    expect(p.left + small.width).toBeLessThanOrEqual(phone.width - 12);
  });

  it('falls back to a centred card when the card fits nowhere around a huge target', () => {
    const everything: Box = { top: 0, left: 0, width: 375, height: 667 };
    expect(placeCard(everything, card, phone, 'bottom').side).toBe('center');
  });

  it('a card wider than the screen is pinned to the margin rather than pushed off it', () => {
    const p = placeCard(null, { width: 500, height: 200 }, { width: 400, height: 600 }, 'bottom');
    expect(p.left).toBe(12);
  });
});

describe('spotlightBox', () => {
  it('adds breathing room but stays on screen', () => {
    expect(spotlightBox({ top: 100, left: 100, width: 40, height: 40 }, desktop)).toEqual({ top: 94, left: 94, width: 52, height: 52 });
    expect(spotlightBox({ top: 0, left: 0, width: 68, height: 800 }, desktop)).toEqual({ top: 0, left: 0, width: 74, height: 800 });
  });
});

describe('sameBox', () => {
  it('compares by value (and null safely)', () => {
    expect(sameBox({ top: 1, left: 2, width: 3, height: 4 }, { top: 1, left: 2, width: 3, height: 4 })).toBe(true);
    expect(sameBox({ top: 1, left: 2, width: 3, height: 4 }, { top: 1, left: 2, width: 3, height: 5 })).toBe(false);
    expect(sameBox(null, null)).toBe(true);
    expect(sameBox(null, { top: 0, left: 0, width: 1, height: 1 })).toBe(false);
  });
});

describe('decideAutoStart', () => {
  const base: AutoStartInput = {
    auth: 'signedIn',
    profileReady: true,
    onboarded: true,
    requested: true,
    completed: { guest: false, full: false },
    blocked: false,
  };
  const decide = (over: Partial<AutoStartInput>) => decideAutoStart({ ...base, ...over });

  it('waits while a stored session is still being checked', () => {
    expect(decide({ auth: 'loading' })).toBe('wait');
  });

  it('starts the full tour right after the welcome flow hands it over', () => {
    expect(decide({})).toBe('start-full');
  });

  it('waits for a calm moment (a dialog is open) instead of stacking on top of it', () => {
    expect(decide({ blocked: true })).toBe('wait');
    expect(decide({ auth: 'guest', blocked: true })).toBe('wait');
  });

  it('never runs for someone who finished or skipped it', () => {
    expect(decide({ completed: { guest: false, full: true } })).toBe('none');
    expect(decide({ auth: 'guest', completed: { guest: true, full: false } })).toBe('none');
  });

  it('never ambushes a returning user: onboarded without a hand-off means "quietly mark as seen"', () => {
    expect(decide({ requested: false })).toBe('mark-full-seen');
  });

  it('does not decide anything for a signed-in person until their profile is loaded and they are onboarded', () => {
    expect(decide({ profileReady: false })).toBe('wait');
    expect(decide({ onboarded: false, requested: false })).toBe('wait');
    expect(decide({ onboarded: false })).toBe('wait');
  });

  it('gives a first-time guest the short tour once', () => {
    expect(decide({ auth: 'guest', onboarded: false, requested: false, profileReady: false })).toBe('start-guest');
  });
});

describe('looksLikeFreshInstall', () => {
  it('is true only when nothing of pact’s is stored (the tour’s own record does not count)', () => {
    expect(looksLikeFreshInstall([], 'pact-tour')).toBe(true);
    expect(looksLikeFreshInstall(['pact-tour'], 'pact-tour')).toBe(true);
    expect(looksLikeFreshInstall(['somebody-elses-key'], 'pact-tour')).toBe(true);
    expect(looksLikeFreshInstall(['pact-home'], 'pact-tour')).toBe(false);
    expect(looksLikeFreshInstall(['x', 'pact-notes', 'pact-tour'], 'pact-tour')).toBe(false);
  });
});
