import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_NOTEBOOK_ID, excerpt, sortNotes, useNotesStore } from '@/features/notes/store';

const reset = () =>
  useNotesStore.setState({
    notebooks: [{ id: DEFAULT_NOTEBOOK_ID, name: 'Personal', memberIds: ['local-user'], nextNumber: 1, createdAt: new Date().toISOString() }],
    notes: [],
    activeNotebookId: DEFAULT_NOTEBOOK_ID,
    selectedId: null,
    query: '',
  });

describe('notes store', () => {
  beforeEach(reset);

  it('creates EMPTY notes (the old version stored the literal text "Start writing…")', () => {
    const id = useNotesStore.getState().addNote();
    const note = useNotesStore.getState().notes.find((n) => n.id === id);
    expect(note).toMatchObject({ title: '', body: '', number: 1, pinned: false });
    expect(useNotesStore.getState().selectedId).toBe(id);
  });

  it('never reuses #numbers after deleting the newest note', () => {
    const { addNote, deleteNote } = useNotesStore.getState();
    addNote();
    const second = addNote();
    deleteNote(second);
    const third = useNotesStore.getState().addNote();
    expect(useNotesStore.getState().notes.find((n) => n.id === third)?.number).toBe(3);
  });

  it('undo (restoreNote) puts a deleted note back and selects it', () => {
    const id = useNotesStore.getState().addNote({ title: 'Keep me', body: 'important' });
    const removed = useNotesStore.getState().deleteNote(id);
    expect(useNotesStore.getState().notes).toHaveLength(0);
    useNotesStore.getState().restoreNote(removed as NonNullable<typeof removed>);
    expect(useNotesStore.getState().notes[0]?.title).toBe('Keep me');
    expect(useNotesStore.getState().selectedId).toBe(id);
  });

  it('refuses to delete the last notebook (the old reducer deleted its notes but kept the notebook)', () => {
    useNotesStore.getState().addNote({ title: 'x' });
    expect(useNotesStore.getState().deleteNotebook(DEFAULT_NOTEBOOK_ID)).toBeNull();
    expect(useNotesStore.getState().notes).toHaveLength(1);
  });

  it('deleting a notebook is undoable and activates a fallback', () => {
    const second = useNotesStore.getState().createNotebook('Work');
    useNotesStore.getState().addNote({ title: 'work note' }, second);
    const snap = useNotesStore.getState().deleteNotebook(second);
    expect(snap?.notes).toHaveLength(1);
    expect(useNotesStore.getState().activeNotebookId).toBe(DEFAULT_NOTEBOOK_ID);
    useNotesStore.getState().restoreNotebook(snap as NonNullable<typeof snap>);
    expect(useNotesStore.getState().notebooks).toHaveLength(2);
    expect(useNotesStore.getState().notes[0]?.title).toBe('work note');
  });

  it('only bumps updatedAt when content changes (pinning must not reorder by recency)', async () => {
    const id = useNotesStore.getState().addNote({ title: 'a' });
    const before = useNotesStore.getState().notes[0]?.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    useNotesStore.getState().updateNote(id, { pinned: true });
    expect(useNotesStore.getState().notes[0]?.updatedAt).toBe(before);
    useNotesStore.getState().updateNote(id, { title: 'b' });
    expect(useNotesStore.getState().notes[0]?.updatedAt).not.toBe(before);
  });

  it('does not persist the search query or other ephemeral state', () => {
    useNotesStore.getState().setQuery('secret search');
    useNotesStore.getState().addNote({ title: 'n' });
    const persisted = JSON.parse(localStorage.getItem('pact-notes') ?? '{}').state;
    expect(persisted.query).toBeUndefined();
    expect(persisted.notes).toHaveLength(1);
  });

  it('migrates v2 data (notebooks without counters, notes without pinned)', () => {
    const migrate = useNotesStore.persist.getOptions().migrate;
    const out = migrate?.(
      {
        notebooks: [{ id: 'nb-1', name: 'Personal', memberIds: ['local-user'], createdAt: '2026-01-01' }],
        notes: [{ id: 'n1', notebookId: 'nb-1', number: 7, title: 'old', body: '', createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
        activeNotebookId: 'nb-1',
      },
      2,
    ) as ReturnType<typeof useNotesStore.getState>;
    expect(out.notebooks[0]?.nextNumber).toBe(8);
    expect(out.notes[0]).toMatchObject({ pinned: false, assigneeId: null });
  });

  it('migrates the original v1 shape (flat notes, no notebooks)', () => {
    const migrate = useNotesStore.persist.getOptions().migrate;
    const out = migrate?.({ notes: [{ id: 'a', title: 'one', body: 'x' }, { id: 'b', title: 'two', body: 'y' }] }, 1) as ReturnType<typeof useNotesStore.getState>;
    expect(out.notebooks).toHaveLength(1);
    expect(out.notes.map((n) => n.number)).toEqual([1, 2]);
    expect(out.notes.every((n) => n.notebookId === out.notebooks[0]?.id)).toBe(true);
  });
});

describe('note helpers', () => {
  it('sorts pinned first, then by most recently edited', () => {
    const mk = (id: string, pinned: boolean, updatedAt: string) => ({ id, pinned, updatedAt }) as Parameters<typeof sortNotes>[0][number];
    const sorted = sortNotes([mk('old', false, '2026-01-01'), mk('pinned-old', true, '2025-01-01'), mk('new', false, '2026-06-01')]);
    expect(sorted.map((n) => n.id)).toEqual(['pinned-old', 'new', 'old']);
  });
  it('builds clean list excerpts from markdown', () => {
    expect(excerpt('## Title\n- [ ] **bold** task\n[link](https://x.dev) and `code`')).toBe('Title bold task link and code');
    expect(excerpt('```js\nconsole.log(1)\n```\nafter')).toBe('after');
    expect(excerpt('x'.repeat(300), 20)).toHaveLength(21);
  });
});
