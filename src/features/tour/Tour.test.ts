import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOUR_KEY, useTourStore } from '@/features/tour/store';
import { Tour } from '@/features/tour/Tour';
import { useProfileSync } from '@/lib/supabase/profile';
import { useAuthStore } from '@/store/useAuthStore';
import { useUiStore } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { click, type Mounted, mount, press, run } from '@/test/render';

let view: Mounted | null = null;
const anchors: HTMLElement[] = [];

const dialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const title = () => document.querySelector('#tour-title')?.textContent;
const button = (name: string) =>
  [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === name) as HTMLButtonElement | undefined;

/** A real element carrying data-tour, with a size (happy-dom does no layout, so we say where it is). */
function anchor(name: string, rect: { top: number; left: number; width: number; height: number }) {
  const el = document.createElement('div');
  el.dataset.tour = name;
  el.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON: () => ({}) });
  document.body.append(el);
  anchors.push(el);
  return el;
}

const reset = () => useTourStore.setState({ completed: { guest: false, full: false }, requested: false, active: false, kind: 'full', index: 0 });

beforeEach(() => {
  reset();
  useAuthStore.setState({ status: 'signedIn', user: null });
  useProfileSync.setState({ ready: true });
  useUserStore.setState({ onboarded: true });
  useUiStore.setState({ paletteOpen: false, shortcutsOpen: false, signInOpen: false, captureOpen: false });
  anchor('sections', { top: 70, left: 0, width: 68, height: 500 });
  anchor('palette', { top: 8, left: 1200, width: 32, height: 32 });
  anchor('nav-timer', { top: 200, left: 14, width: 40, height: 40 });
  anchor('nav-settings', { top: 700, left: 14, width: 40, height: 40 });
});

afterEach(async () => {
  await view?.unmount();
  view = null;
  for (const a of anchors.splice(0)) a.remove();
  vi.useRealTimers();
});

describe('the tour overlay', () => {
  it('opens on the first step as an accessible modal dialog, with the primary button focused', async () => {
    useTourStore.getState().start('full');
    view = await mount(createElement(Tour));
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(dialog()?.getAttribute('aria-labelledby')).toBe('tour-title');
    expect(title()).toBe('Your pages live here');
    expect(document.body.textContent).toContain('Step 1 of 5');
    expect(document.activeElement).toBe(button('Next'));
    expect(button('Back')).toBeUndefined();
    expect(document.querySelector('[data-tour-overlay] .pointer-events-none.rounded-lg')).not.toBeNull(); // the cut-out around the sidebar
  });

  it('Next/Back walk the steps; the last one says Done and closes — counted as seen', async () => {
    useTourStore.getState().start('full');
    view = await mount(createElement(Tour));
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push(title() ?? '');
      await click(button('Next') as HTMLButtonElement);
    }
    expect(seen).toEqual(['Your pages live here', 'Search or jump anywhere', 'Capture a thought in a second', 'A timer that keeps going']);
    expect(title()).toBe('Make it yours');
    await click(button('Back') as HTMLButtonElement);
    expect(title()).toBe('A timer that keeps going');
    await click(button('Next') as HTMLButtonElement);
    expect(button('Next')).toBeUndefined();
    await click(button('Done') as HTMLButtonElement);
    expect(dialog()).toBeNull();
    expect(useTourStore.getState().completed.full).toBe(true);
    expect(JSON.parse(localStorage.getItem(TOUR_KEY) ?? '{}').state.completed.full).toBe(true);
  });

  it('Escape skips the whole tour, and so does the Skip button — neither starts it again', async () => {
    useTourStore.getState().start('full');
    view = await mount(createElement(Tour));
    await press(window as unknown as Element, 'Escape');
    expect(dialog()).toBeNull();
    expect(useTourStore.getState().completed.full).toBe(true);

    reset();
    useTourStore.getState().start('full');
    await run(() => {});
    expect(dialog()).not.toBeNull();
    await click(button('Skip tour') as HTMLButtonElement);
    expect(dialog()).toBeNull();
    expect(useTourStore.getState().completed.full).toBe(true);
  });

  it('the arrow keys move between steps', async () => {
    useTourStore.getState().start('full');
    view = await mount(createElement(Tour));
    await press(window as unknown as Element, 'ArrowRight');
    expect(title()).toBe('Search or jump anywhere');
    await press(window as unknown as Element, 'ArrowLeft');
    expect(title()).toBe('Your pages live here');
    await press(window as unknown as Element, 'ArrowLeft');
    expect(title()).toBe('Your pages live here'); // can't go before the start
  });

  it('keeps Tab inside the card (it is modal) and puts focus back where it was when it closes', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    useTourStore.getState().start('full');
    view = await mount(createElement(Tour));
    const buttons = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')];
    const last = buttons.at(-1) as HTMLElement;
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await run(() => void window.dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);

    opener.focus(); // focus escaped somehow: Tab pulls it back in
    await run(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(dialog()?.contains(document.activeElement)).toBe(true);

    await press(window as unknown as Element, 'Escape');
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('with the target hidden (a phone has no sidebar rail) it still works, as a centred card', async () => {
    for (const a of anchors.splice(0)) a.remove();
    anchor('sections', { top: 0, left: 0, width: 0, height: 0 }); // display:none measures as 0 × 0
    useTourStore.getState().start('full');
    view = await mount(createElement(Tour));
    expect(dialog()).not.toBeNull();
    expect(title()).toBe('Your pages live here');
    expect(document.querySelector('[data-tour-overlay] .rounded-lg.pointer-events-none')).toBeNull(); // no cut-out without a target
    await click(button('Next') as HTMLButtonElement);
    await click(button('Next') as HTMLButtonElement);
    expect(title()).toBe('Capture a thought in a second'); // a step with no target at all
  });

  it('the guest tour never mentions pages a guest can’t reach, and closes if they sign in mid-way', async () => {
    useAuthStore.setState({ status: 'guest' });
    anchor('sign-in', { top: 8, left: 1100, width: 70, height: 28 });
    useTourStore.getState().start('guest');
    view = await mount(createElement(Tour));
    const titles: string[] = [];
    while (button('Next')) {
      titles.push(title() ?? '');
      await click(button('Next') as HTMLButtonElement);
    }
    titles.push(title() ?? '');
    expect(titles).toEqual(['Search or jump anywhere', 'Capture a thought in a second', 'There’s more behind a sign-in', 'Sign in when you’re ready']);
    expect(document.body.textContent).not.toContain('timer that keeps going');

    reset();
    useTourStore.getState().start('guest');
    await run(() => {});
    expect(dialog()).not.toBeNull();
    await run(() => {
      useAuthStore.setState({ status: 'signedIn' });
    });
    expect(dialog()).toBeNull();
  });
});

describe('when it starts by itself', () => {
  const wait = (ms = 800) => run(() => void vi.advanceTimersByTime(ms));

  it('a first-time guest gets the short tour after the page settles', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    useAuthStore.setState({ status: 'guest' });
    view = await mount(createElement(Tour));
    expect(dialog()).toBeNull();
    await wait();
    expect(dialog()).not.toBeNull();
    expect(useTourStore.getState().kind).toBe('guest');
  });

  it('a guest who already saw it is left alone', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    useAuthStore.setState({ status: 'guest' });
    useTourStore.setState({ completed: { guest: true, full: false } });
    view = await mount(createElement(Tour));
    await wait();
    expect(dialog()).toBeNull();
  });

  it('the welcome flow’s hand-off starts the full tour', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    useTourStore.getState().request();
    view = await mount(createElement(Tour));
    await wait();
    expect(dialog()).not.toBeNull();
    expect(useTourStore.getState()).toMatchObject({ kind: 'full', requested: false, active: true });
  });

  it('a returning user — already onboarded, no hand-off — is never shown it, and is quietly marked as having seen it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    view = await mount(createElement(Tour));
    await wait(2000);
    expect(dialog()).toBeNull();
    expect(useTourStore.getState().completed.full).toBe(true);
  });

  it('waits while the welcome dialog is still going (not onboarded yet), and while another dialog is open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    useUserStore.setState({ onboarded: false });
    view = await mount(createElement(Tour));
    await wait(2000);
    expect(dialog()).toBeNull();
    expect(useTourStore.getState().completed.full).toBe(false);

    useTourStore.getState().request();
    await run(() => {
      useUserStore.setState({ onboarded: true });
    });
    await run(() => {
      useUiStore.setState({ paletteOpen: true });
    });
    await wait(2000);
    expect(dialog()).toBeNull(); // the palette is open: wait
    await run(() => {
      useUiStore.setState({ paletteOpen: false });
    });
    await wait();
    expect(dialog()).not.toBeNull();
  });

  it('does not start while the session is still being checked, nor before the profile has loaded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    useTourStore.getState().request();
    useAuthStore.setState({ status: 'loading' });
    view = await mount(createElement(Tour));
    await wait(2000);
    expect(dialog()).toBeNull();
    useAuthStore.setState({ status: 'signedIn' });
    useProfileSync.setState({ ready: false });
    await wait(2000);
    expect(dialog()).toBeNull();
    await run(() => {
      useProfileSync.setState({ ready: true });
    });
    await wait();
    expect(dialog()).not.toBeNull();
  });
});
