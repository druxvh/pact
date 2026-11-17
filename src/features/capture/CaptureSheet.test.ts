import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureSheet } from '@/features/capture/CaptureSheet';
import { useCaptureStore } from '@/features/capture/store';
import { useHomeLayoutStore } from '@/features/home/layout';
import { useKanbanStore } from '@/features/kanban/store';
import { useNotesStore } from '@/features/notes/store';
import { click, type Mounted, mount, press, run, type } from '@/test/render';

let view: Mounted | null = null;
const onDone = vi.fn();

const sheet = (account: boolean, variant: 'popup' | 'dialog' = 'popup') =>
  mount(createElement(CaptureSheet, { account, variant, title: createElement('h1', null, 'Quick capture'), onDone }));
const textarea = () => document.querySelector('textarea') as HTMLTextAreaElement;
const tab = (name: string) => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.trim() === name);

beforeEach(() => {
  useNotesStore.setState(useNotesStore.getInitialState(), true);
  useKanbanStore.setState(useKanbanStore.getInitialState(), true);
  useHomeLayoutStore.setState(useHomeLayoutStore.getInitialState(), true);
  useCaptureStore.setState(useCaptureStore.getInitialState(), true);
  onDone.mockClear();
});

afterEach(async () => {
  await view?.unmount();
  view = null;
});

describe('the capture sheet', () => {
  it('opens focused and empty, with Save disabled until there is something to save', async () => {
    view = await sheet(true);
    expect(document.activeElement).toBe(textarea());
    const save = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Save note') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await type(textarea(), 'hello');
    expect(save.disabled).toBe(false);
  });

  it('Tab flips Note ⇄ Task; Shift+Tab is left alone so the keyboard is never trapped', async () => {
    view = await sheet(true);
    expect(useCaptureStore.getState().kind).toBe('note');
    const flip = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await run(() => void textarea().dispatchEvent(flip));
    expect(flip.defaultPrevented).toBe(true);
    expect(useCaptureStore.getState().kind).toBe('task');
    expect(tab('Task')?.getAttribute('aria-selected')).toBe('true');
    expect(textarea().placeholder).toBe('What needs doing?');

    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    await run(() => void textarea().dispatchEvent(back));
    expect(back.defaultPrevented).toBe(false);
    expect(useCaptureStore.getState().kind).toBe('task');
  });

  it('in note mode Enter is just a new line, and ⌘/Ctrl+Enter saves', async () => {
    view = await sheet(true);
    await type(textarea(), 'Meeting notes\nline two');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await run(() => void textarea().dispatchEvent(enter));
    expect(enter.defaultPrevented).toBe(false);
    expect(useNotesStore.getState().notes).toHaveLength(0);

    await press(textarea(), 'Enter', { ctrlKey: true });
    await vi.waitFor(() => expect(useNotesStore.getState().notes).toHaveLength(1));
    expect(useNotesStore.getState().notes[0]).toMatchObject({ title: 'Meeting notes', body: 'line two' });
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Notes · Personal');
  });

  it('in task mode Enter saves, Shift+Enter is a new line, and the sheet reports back after the confirmation', async () => {
    view = await sheet(true);
    await press(textarea(), 'Tab');
    await type(textarea(), 'Book flights');
    const shiftEnter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
    await run(() => void textarea().dispatchEvent(shiftEnter));
    expect(shiftEnter.defaultPrevented).toBe(false);
    expect(useKanbanStore.getState().tasks).toHaveLength(0);

    await press(textarea(), 'Enter');
    await vi.waitFor(() => expect(useKanbanStore.getState().tasks).toHaveLength(1));
    expect(useKanbanStore.getState().tasks[0]?.title).toBe('Book flights');
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Task added');
    expect(onDone).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(onDone.mock.calls[0]?.[0]).toMatchObject({ ok: true, kind: 'task' });
  });

  it('does not treat Enter that confirms an IME candidate as "save"', async () => {
    view = await sheet(true);
    await press(textarea(), 'Tab');
    await type(textarea(), 'にほん');
    await press(textarea(), 'Enter', { isComposing: true });
    expect(useKanbanStore.getState().tasks).toHaveLength(0);
  });

  it('shows where it will land, and lets you pick a notebook; the choice is remembered', async () => {
    const work = useNotesStore.getState().createNotebook('Work');
    view = await sheet(true);
    expect(document.body.textContent).toContain('Saves to');
    const select = document.querySelector('select') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Personal', 'Work']);
    await run(() => {
      select.value = work;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(useCaptureStore.getState().notebookId).toBe(work);
    await type(textarea(), 'to work');
    await press(textarea(), 'Enter', { metaKey: true });
    await vi.waitFor(() => expect(useNotesStore.getState().notes[0]?.notebookId).toBe(work));
  });

  it('keeps an unsent draft for the next time (a popup closes the moment it loses focus)', async () => {
    view = await sheet(true);
    await type(textarea(), 'half a thought');
    expect(useCaptureStore.getState().draft).toBe('half a thought');
    await view.unmount();
    view = await sheet(true);
    expect(textarea().value).toBe('half a thought');
  });

  it('Esc closes the popup without saving', async () => {
    view = await sheet(true);
    await type(textarea(), 'nope');
    await press(textarea(), 'Escape');
    expect(onDone).toHaveBeenCalledWith(null);
    expect(useNotesStore.getState().notes).toHaveLength(0);
  });

  it('explains instead of saving when there is nothing to save', async () => {
    view = await sheet(true);
    await press(textarea(), 'Enter', { ctrlKey: true });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Type something first');
  });
});

describe('as a guest', () => {
  it('has no Note/Task switch (there is no Notes or Kanban), says where it goes, and keeps the text in the Home quick note', async () => {
    view = await sheet(false);
    expect(tab('Task')).toBeUndefined();
    expect(document.body.textContent).toContain('Home · Quick note');
    await type(textarea(), 'remember the milk');
    await press(textarea(), 'Tab');
    expect(useCaptureStore.getState().kind).toBe('note'); // Tab did nothing
    await click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Save') as HTMLButtonElement);
    await vi.waitFor(() => expect(useHomeLayoutStore.getState().draft).toBe('remember the milk'));
    expect(useNotesStore.getState().notes).toHaveLength(0);
  });
});
