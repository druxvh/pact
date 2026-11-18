import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOFOCUS_AT,
  canTakeFocus,
  focusHomeOmnibox,
  hasHomeOmnibox,
  modalIsOpen,
  type OmniboxHost,
  type OmniboxState,
  omniboxIntent,
  registerHomeOmnibox,
  startAutoFocus,
  summonOmnibox,
} from '@/lib/omnibox/focus';

const state = (over: Partial<OmniboxState> = {}): OmniboxState => ({ paletteOpen: false, section: 'home', homeBox: true, modalOpen: false, ...over });

describe('omniboxIntent: what ⌘K does', () => {
  it('on Home with the box on screen it focuses the box', () => {
    expect(omniboxIntent(state())).toBe('focus-home');
  });

  it('on every other page it opens the overlay palette', () => {
    for (const section of ['notes', 'kanban', 'timer', 'tools', 'chat', 'party', 'settings'])
      expect(omniboxIntent(state({ section, homeBox: false }))).toBe('open-palette');
    // a stale registration (the Home box mid-exit-animation while the next page loads) must not win
    expect(omniboxIntent(state({ section: 'notes', homeBox: true }))).toBe('open-palette');
  });

  it('on Home without a box (the layout hides search) it opens the palette', () => {
    expect(omniboxIntent(state({ homeBox: false }))).toBe('open-palette');
  });

  it('while the palette is open it closes it, wherever you are', () => {
    expect(omniboxIntent(state({ paletteOpen: true }))).toBe('close-palette');
    expect(omniboxIntent(state({ paletteOpen: true, section: 'notes', homeBox: false }))).toBe('close-palette');
  });

  it('with another dialog open on Home it opens the palette instead of focusing a box behind the dialog', () => {
    expect(omniboxIntent(state({ modalOpen: true }))).toBe('open-palette');
  });
});

describe('summonOmnibox', () => {
  const host = (over: Partial<ReturnType<OmniboxHost['state']>> = {}) => {
    const setPaletteOpen = vi.fn<(open: boolean) => void>();
    const h: OmniboxHost = { state: () => ({ paletteOpen: false, section: 'home', modalOpen: false, ...over }), setPaletteOpen };
    return Object.assign(h, { setPaletteOpen });
  };

  it('focuses the registered Home box and leaves the palette closed', () => {
    const focus = vi.fn();
    const off = registerHomeOmnibox({ focus });
    const h = host();
    expect(summonOmnibox(h)).toBe('focus-home');
    expect(focus).toHaveBeenCalledTimes(1);
    expect(h.setPaletteOpen).not.toHaveBeenCalled();
    off();
  });

  it('opens the palette on Home when no box is registered', () => {
    const h = host();
    expect(hasHomeOmnibox()).toBe(false);
    expect(summonOmnibox(h)).toBe('open-palette');
    expect(h.setPaletteOpen).toHaveBeenCalledWith(true);
  });

  it('opens the palette on other pages even though the Home box is still registered', () => {
    const focus = vi.fn();
    const off = registerHomeOmnibox({ focus });
    const h = host({ section: 'notes' });
    expect(summonOmnibox(h)).toBe('open-palette');
    expect(focus).not.toHaveBeenCalled();
    expect(h.setPaletteOpen).toHaveBeenCalledWith(true);
    off();
  });

  it('a second press closes the open palette — but a click on the search button never does', () => {
    const h = host({ paletteOpen: true, section: 'notes' });
    expect(summonOmnibox(h, { toggle: false })).toBeNull();
    expect(h.setPaletteOpen).not.toHaveBeenCalled();
    expect(summonOmnibox(h)).toBe('close-palette');
    expect(h.setPaletteOpen).toHaveBeenCalledWith(false);
  });
});

describe('registerHomeOmnibox', () => {
  it('the latest registration wins and unregistering restores the previous one', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerHomeOmnibox({ focus: a });
    const offB = registerHomeOmnibox({ focus: b });
    expect(focusHomeOmnibox()).toBe(true);
    expect(b).toHaveBeenCalledTimes(1);
    offB();
    expect(focusHomeOmnibox()).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    offA();
    expect(hasHomeOmnibox()).toBe(false);
    expect(focusHomeOmnibox()).toBe(false);
  });
});

describe('autofocus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const input = () => {
    const el = document.createElement('input');
    document.body.append(el);
    return el;
  };

  it('canTakeFocus: only when nothing meaningful holds focus and no dialog is open', () => {
    expect(canTakeFocus(document.body)).toBe(true);
    expect(canTakeFocus(null)).toBe(true);
    expect(canTakeFocus(input())).toBe(false);
    const d = document.createElement('div');
    d.setAttribute('role', 'dialog');
    document.body.append(d);
    expect(modalIsOpen()).toBe(true);
    expect(canTakeFocus(document.body)).toBe(false);
  });

  it('focuses the box once the page is up', () => {
    const el = input();
    startAutoFocus(el);
    vi.advanceTimersByTime(1);
    expect(document.activeElement).toBe(el);
  });

  it('keeps trying while the browser holds focus elsewhere, then takes it', () => {
    const el = input();
    const other = input();
    other.focus();
    startAutoFocus(el);
    vi.advanceTimersByTime(300);
    expect(document.activeElement).toBe(other); // never steals from another field
    other.blur();
    vi.advanceTimersByTime(300);
    expect(document.activeElement).toBe(el);
  });

  it('never pulls focus out of an open dialog, and tries again once it is gone', () => {
    const el = input();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    startAutoFocus(el);
    vi.advanceTimersByTime(250);
    expect(document.activeElement).not.toBe(el);
    dialog.remove();
    vi.advanceTimersByTime(300);
    expect(document.activeElement).toBe(el);
  });

  it('gives up for good once the person clicks or types', () => {
    const el = input();
    startAutoFocus(el);
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(5000);
    expect(document.activeElement).not.toBe(el);
  });

  it('stops by itself after the last attempt and its cleanup cancels everything', () => {
    const el = input();
    const stop = startAutoFocus(el);
    const last = AUTOFOCUS_AT[AUTOFOCUS_AT.length - 1] ?? 0;
    stop();
    vi.advanceTimersByTime(last + 500);
    expect(document.activeElement).not.toBe(el);
  });
});
