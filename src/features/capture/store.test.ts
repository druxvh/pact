import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_CAPTURE_CHARS } from '@/features/capture/capture';
import { AUTH_KEY, CAPTURE_KEY, currentTarget, hasStoredAccount, saveCapture, useCaptureStore } from '@/features/capture/store';
import { useHomeLayoutStore } from '@/features/home/layout';
import { DEFAULT_BOARD_ID, useKanbanStore } from '@/features/kanban/store';
import { DEFAULT_NOTEBOOK_ID, useNotesStore } from '@/features/notes/store';
import { AUTH_STORAGE_KEY } from '@/lib/supabase/client';

const target = { notebookId: null, boardId: null, columnId: 'todo' } as const;

beforeEach(() => {
  useNotesStore.setState(useNotesStore.getInitialState(), true);
  useKanbanStore.setState(useKanbanStore.getInitialState(), true);
  useHomeLayoutStore.setState(useHomeLayoutStore.getInitialState(), true);
  useCaptureStore.setState(useCaptureStore.getInitialState(), true);
});

describe('saving a note', () => {
  it('adds it to the notebook, splitting title and body like the Home quick note does', async () => {
    const r = await saveCapture({ ...target, kind: 'note', account: true, text: 'Trip ideas\n- lisbon\n- porto' });
    expect(r).toMatchObject({ ok: true, kind: 'note', where: 'Notes · Personal' });
    const [note] = useNotesStore.getState().notes;
    expect(note).toMatchObject({ title: 'Trip ideas', body: '- lisbon\n- porto', notebookId: DEFAULT_NOTEBOOK_ID, number: 1, pinned: false });
    expect(useNotesStore.getState().notebooks[0]?.nextNumber).toBe(2);
    // and it reached storage, which is how another extension page (an open pact tab) sees it
    expect(localStorage.getItem('pact-notes')).toContain('Trip ideas');
  });

  it('does not move whoever is reading: selection, active notebook and search stay put', async () => {
    const other = useNotesStore.getState().createNotebook('Work');
    useNotesStore.getState().setActiveNotebook(other);
    useNotesStore.getState().setQuery('x');
    const before = useNotesStore.getState();
    await saveCapture({ ...target, kind: 'note', account: true, text: 'quick', notebookId: DEFAULT_NOTEBOOK_ID });
    const after = useNotesStore.getState();
    expect(after.activeNotebookId).toBe(before.activeNotebookId);
    expect(after.selectedId).toBe(before.selectedId);
    expect(after.query).toBe('x');
    expect(after.notes[0]?.notebookId).toBe(DEFAULT_NOTEBOOK_ID);
  });

  it('numbers notes after the ones that are already there, per notebook', async () => {
    await saveCapture({ ...target, kind: 'note', account: true, text: 'one' });
    await saveCapture({ ...target, kind: 'note', account: true, text: 'two' });
    expect(useNotesStore.getState().notes.map((n) => [n.title, n.number])).toEqual([
      ['two', 2],
      ['one', 1],
    ]);
  });

  it('starts from what is on disk, so a write by another page is not lost', async () => {
    await saveCapture({ ...target, kind: 'note', account: true, text: 'mine' });
    // another page writes a note straight to storage after this page loaded
    const stored = JSON.parse(localStorage.getItem('pact-notes') ?? '{}');
    stored.state.notes.push({ ...stored.state.notes[0], id: 'note_from_elsewhere', title: 'theirs', number: 9 });
    localStorage.setItem('pact-notes', JSON.stringify(stored));
    await saveCapture({ ...target, kind: 'note', account: true, text: 'later' });
    expect(
      useNotesStore
        .getState()
        .notes.map((n) => n.title)
        .sort(),
    ).toEqual(['later', 'mine', 'theirs']);
  });

  it('remembers the notebook and kind, and clears the unsent draft', async () => {
    const work = useNotesStore.getState().createNotebook('Work');
    useCaptureStore.getState().setDraft('half-typed');
    const r = await saveCapture({ ...target, kind: 'note', account: true, text: 'hello', notebookId: work });
    expect(r).toMatchObject({ ok: true, where: 'Notes · Work' });
    expect(useCaptureStore.getState()).toMatchObject({ kind: 'note', notebookId: work, draft: '' });
  });

  it('falls back to a notebook that exists when the chosen one is gone', async () => {
    const r = await saveCapture({ ...target, kind: 'note', account: true, text: 'hello', notebookId: 'deleted-notebook' });
    expect(r).toMatchObject({ ok: true, where: 'Notes · Personal' });
  });
});

describe('saving a task', () => {
  it('adds it to the board column with the first line as the title', async () => {
    const r = await saveCapture({
      ...target,
      kind: 'task',
      account: true,
      text: 'Book flights\nbefore Friday',
      boardId: DEFAULT_BOARD_ID,
      columnId: 'in_progress',
    });
    expect(r).toMatchObject({ ok: true, kind: 'task', where: 'Kanban · Personal · In progress' });
    expect(useKanbanStore.getState().tasks[0]).toMatchObject({
      title: 'Book flights',
      description: 'before Friday',
      columnId: 'in_progress',
      boardId: DEFAULT_BOARD_ID,
      completedAt: null,
    });
    expect(useCaptureStore.getState()).toMatchObject({ kind: 'task', columnId: 'in_progress', boardId: DEFAULT_BOARD_ID });
  });

  it('leaves the notes alone', async () => {
    await saveCapture({ ...target, kind: 'task', account: true, text: 'do it' });
    expect(useNotesStore.getState().notes).toEqual([]);
  });
});

describe('a guest', () => {
  it('has no Notes or Kanban, so a capture goes to the Home quick note — even if it was asked to be a task', async () => {
    const r = await saveCapture({ ...target, kind: 'task', account: false, text: 'first' });
    expect(r).toEqual({ ok: true, kind: 'draft', where: 'Home · Quick note' });
    await saveCapture({ ...target, kind: 'note', account: false, text: 'second' });
    expect(useHomeLayoutStore.getState().draft).toBe('first\n\nsecond');
    expect(useNotesStore.getState().notes).toEqual([]);
    expect(useKanbanStore.getState().tasks).toEqual([]);
    expect(localStorage.getItem('pact-home-layout')).toContain('second'); // where Home's Quick note widget reads it
  });

  it('is told when the quick note would overflow, and nothing is lost', async () => {
    useHomeLayoutStore.getState().setDraft('x'.repeat(MAX_CAPTURE_CHARS - 2));
    const r = await saveCapture({ ...target, kind: 'note', account: false, text: 'abcdef' });
    expect(r).toEqual({ ok: false, reason: 'too-long' });
    expect(useHomeLayoutStore.getState().draft).toHaveLength(MAX_CAPTURE_CHARS - 2);
  });
});

describe('bad input', () => {
  it('refuses empty and over-long text', async () => {
    expect(await saveCapture({ ...target, kind: 'note', account: true, text: '  \n ' })).toEqual({ ok: false, reason: 'empty' });
    expect(await saveCapture({ ...target, kind: 'note', account: true, text: 'x'.repeat(MAX_CAPTURE_CHARS + 1) })).toEqual({ ok: false, reason: 'too-long' });
    expect(useNotesStore.getState().notes).toEqual([]);
  });
});

describe('prefs', () => {
  it('coerce junk from storage and cap the draft', async () => {
    localStorage.setItem(
      CAPTURE_KEY,
      JSON.stringify({ state: { kind: 'bogus', notebookId: 5, boardId: 'b', columnId: 'nope', draft: 'x'.repeat(MAX_CAPTURE_CHARS + 50) }, version: 1 }),
    );
    await useCaptureStore.persist.rehydrate();
    const s = useCaptureStore.getState();
    expect([s.kind, s.notebookId, s.boardId, s.columnId]).toEqual(['note', null, 'b', 'todo']);
    expect(s.draft).toHaveLength(MAX_CAPTURE_CHARS);
  });

  it('the destination falls back to the app’s own defaults when nothing is remembered', () => {
    expect(currentTarget()).toEqual({ notebookId: DEFAULT_NOTEBOOK_ID, boardId: DEFAULT_BOARD_ID, columnId: 'todo' });
  });
});

describe('the popup’s account check', () => {
  it('reads the same storage key the app’s Supabase client uses (without importing the client into the popup)', () => {
    expect(AUTH_KEY).toBe(AUTH_STORAGE_KEY);
    expect(hasStoredAccount()).toBe(false);
    localStorage.setItem(AUTH_KEY, '{}');
    expect(hasStoredAccount()).toBe(true);
  });
});
