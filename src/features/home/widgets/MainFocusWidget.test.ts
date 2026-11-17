import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MainFocusWidget } from '@/features/home/widgets/MainFocusWidget';
import { useMainFocusStore } from '@/features/home/widgets/mainFocusStore';
import { dateKey } from '@/features/home/widgets/today';
import { useTimerStore } from '@/features/timer/store';
import { useAuthStore } from '@/store/useAuthStore';
import { useNavStore } from '@/store/useNavStore';
import { click, type Mounted, mount, press, run, type } from '@/test/render';

let view: Mounted | null = null;
const input = () => document.querySelector('#main-focus-input') as HTMLInputElement | null;
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
const check = () => document.querySelector('#main-focus-check') as HTMLButtonElement;

beforeEach(() => {
  useMainFocusStore.setState({ entries: [] });
  useTimerStore.setState(useTimerStore.getInitialState(), true);
  useAuthStore.setState({ status: 'guest', user: null });
  useNavStore.setState({ section: 'home', sub: null });
});

afterEach(async () => {
  await view?.unmount();
  view = null;
  vi.useRealTimers();
});

describe('the main focus widget', () => {
  it('asks the question, takes an answer on Enter, and shows it with an unchecked circle', async () => {
    view = await mount(createElement(MainFocusWidget));
    expect(document.body.textContent).toContain('What’s your main focus today?');
    expect(button('Set focus')?.disabled).toBe(true);
    await type(input() as HTMLInputElement, '  Finish the outline ');
    await run(() => void (input() as HTMLInputElement).form?.requestSubmit());
    expect(useMainFocusStore.getState().entries).toEqual([{ day: dateKey(), text: 'Finish the outline', doneAt: null }]);
    expect(document.body.textContent).toContain('Finish the outline');
    expect(input()).toBeNull();
    expect(check().getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(check()); // focus moves to the control that replaced the form
  });

  it('checking it off is a toggle: done state, streak and a way back', async () => {
    useMainFocusStore.getState().setToday('Ship it');
    view = await mount(createElement(MainFocusWidget));
    await click(check());
    expect(check().getAttribute('aria-pressed')).toBe('true');
    expect(useMainFocusStore.getState().entries[0]?.doneAt).not.toBeNull();
    expect(document.body.textContent).toContain('Done');
    expect(document.querySelector('.line-through')?.textContent).toBe('Ship it');
    await click(check());
    expect(check().getAttribute('aria-pressed')).toBe('false');
    expect(useMainFocusStore.getState().entries[0]?.doneAt).toBeNull();
  });

  it('can be edited in place, and Escape cancels the edit', async () => {
    useMainFocusStore.getState().setToday('Old plan');
    view = await mount(createElement(MainFocusWidget));
    await click(document.querySelector('#main-focus-edit') as HTMLButtonElement);
    expect(input()?.value).toBe('Old plan');
    await type(input() as HTMLInputElement, 'New plan');
    await run(() => void (input() as HTMLInputElement).form?.requestSubmit());
    expect(useMainFocusStore.getState().entries[0]?.text).toBe('New plan');

    await click(document.querySelector('#main-focus-edit') as HTMLButtonElement);
    await type(input() as HTMLInputElement, 'Discarded');
    await press(input() as HTMLInputElement, 'Escape');
    expect(input()).toBeNull();
    expect(useMainFocusStore.getState().entries[0]?.text).toBe('New plan');
  });

  it('shows yesterday’s focus, with a tick if it was completed', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    useMainFocusStore.getState().setToday('Draft the report', yesterday);
    useMainFocusStore.getState().toggleToday(yesterday);
    view = await mount(createElement(MainFocusWidget));
    expect(document.body.textContent).toContain('Yesterday: Draft the report ✓');
  });

  it('a guest can use it, but has no “start a focus session” (the Focus timer needs an account)', async () => {
    useMainFocusStore.getState().setToday('Read a chapter');
    view = await mount(createElement(MainFocusWidget));
    expect(button('Start a focus session')).toBeUndefined();
    await click(check());
    expect(useMainFocusStore.getState().entries[0]?.doneAt).not.toBeNull();
  });

  it('signed in: “Start a focus session” hands the focus to the timer and opens it', async () => {
    useAuthStore.setState({ status: 'signedIn' });
    useMainFocusStore.getState().setToday('Read a chapter');
    view = await mount(createElement(MainFocusWidget));
    await click(button('Start a focus session') as HTMLButtonElement);
    expect(useTimerStore.getState().intent).toBe('Read a chapter');
    expect(useNavStore.getState().section).toBe('timer');
  });

  it('once it is done there is nothing left to start, and the button goes away', async () => {
    useAuthStore.setState({ status: 'signedIn' });
    useMainFocusStore.getState().setToday('Read a chapter');
    view = await mount(createElement(MainFocusWidget));
    expect(button('Start a focus session')).toBeDefined();
    await click(check());
    expect(button('Start a focus session')).toBeUndefined();
  });

  it('rolls over at midnight by itself: yesterday’s focus becomes "Yesterday" and the prompt comes back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 10, 17, 23, 59, 40));
    useMainFocusStore.getState().setToday('Finish the report');
    useMainFocusStore.getState().toggleToday();
    view = await mount(createElement(MainFocusWidget));
    expect(check().getAttribute('aria-pressed')).toBe('true');

    await run(() => {
      vi.setSystemTime(new Date(2026, 10, 18, 0, 0, 5));
      vi.advanceTimersByTime(30_000);
    });
    expect(input()).not.toBeNull(); // a new day: ask again
    expect(document.body.textContent).toContain('Yesterday: Finish the report ✓');
  });

  it('survives a laptop that slept for days: the check on return shows a fresh day, not a stale one', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 10, 14, 17, 0, 0));
    useMainFocusStore.getState().setToday('Friday’s thing');
    view = await mount(createElement(MainFocusWidget));
    await run(() => {
      vi.setSystemTime(new Date(2026, 10, 17, 8, 0, 0)); // Monday morning; no timer ever fired
      window.dispatchEvent(new Event('focus'));
    });
    expect(input()).not.toBeNull();
    expect(document.body.textContent).toMatch(/Friday|Nov 14/);
    expect(document.body.textContent).toContain('Friday’s thing');
  });
});
