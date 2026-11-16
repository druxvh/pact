import { describe, expect, it } from 'vitest';
import type { Note, Notebook } from '@/features/notes/types';
import { emptySyncState, mergeRemote, type NotebookRow, type NoteRow, notebookToRow, noteToRow, pendingCount, trackChanges } from './model';

const T = (n: number) => new Date(Date.UTC(2026, 10, 16, 12, 0, n)).toISOString();

const nb = (id: string, over: Partial<Notebook> = {}): Notebook => ({ id, name: id, memberIds: ['local-user'], nextNumber: 1, createdAt: T(0), ...over });
const note = (id: string, over: Partial<Note> = {}): Note => ({
  id,
  notebookId: 'nb1',
  number: 1,
  title: id,
  body: '',
  pinned: false,
  assigneeId: null,
  createdAt: T(0),
  updatedAt: T(0),
  ...over,
});
const nbRow = (id: string, over: Partial<NotebookRow> = {}): NotebookRow => ({ ...notebookToRow(nb(id), T(5)), ...over });
const noteRow = (id: string, over: Partial<NoteRow> = {}): NoteRow => ({ ...noteToRow(note(id), T(5)), ...over });

describe('trackChanges', () => {
  const base = { notebooks: [nb('nb1')], notes: [note('a'), note('b')] };

  it('marks added and edited notes dirty, untouched ones not', () => {
    const edited = { ...base.notes[0], title: 'new' } as Note;
    const next = { notebooks: base.notebooks, notes: [edited, base.notes[1] as Note, note('c')] };
    const s = trackChanges(emptySyncState('u'), base, next, T(10));
    expect(Object.keys(s.dirtyNotes).sort()).toEqual(['a', 'c']);
    expect(s.dirtyNotes.a).toBe(T(10));
  });

  it('marks removed notes as gone and clears their dirty mark', () => {
    let s = trackChanges(
      emptySyncState('u'),
      base,
      { notebooks: base.notebooks, notes: [{ ...base.notes[0], title: 'x' } as Note, base.notes[1] as Note] },
      T(1),
    );
    s = trackChanges(
      s,
      { notebooks: base.notebooks, notes: [{ ...base.notes[0], title: 'x' } as Note, base.notes[1] as Note] },
      { notebooks: base.notebooks, notes: [base.notes[1] as Note] },
      T(2),
    );
    expect(s.goneNotes).toEqual({ a: T(2) });
    expect(s.dirtyNotes.a).toBeUndefined();
  });

  it('an undone delete stops being gone and becomes dirty again', () => {
    const gone = trackChanges(emptySyncState('u'), base, { notebooks: base.notebooks, notes: [base.notes[1] as Note] }, T(1));
    const back = trackChanges(gone, { notebooks: base.notebooks, notes: [base.notes[1] as Note] }, base, T(2));
    expect(back.goneNotes.a).toBeUndefined();
    expect(back.dirtyNotes.a).toBe(T(2));
  });

  it('pinning counts as a change even though it keeps updatedAt', () => {
    const pinned = { ...base.notes[0], pinned: true } as Note;
    const s = trackChanges(emptySyncState('u'), base, { notebooks: base.notebooks, notes: [pinned, base.notes[1] as Note] }, T(3));
    expect(s.dirtyNotes.a).toBe(T(3));
  });

  it('changing only the local-only assignee does not upload anything', () => {
    const assigned = { ...base.notes[0], assigneeId: 'alex' } as Note;
    const s = trackChanges(emptySyncState('u'), base, { notebooks: base.notebooks, notes: [assigned, base.notes[1] as Note] }, T(3));
    expect(pendingCount(s)).toBe(0);
  });

  it('tracks notebook renames, counters and deletions', () => {
    const renamed = { notebooks: [nb('nb1', { name: 'Work' })], notes: base.notes };
    expect(trackChanges(emptySyncState('u'), base, renamed, T(1)).dirtyNotebooks.nb1).toBe(T(1));
    const removed = { notebooks: [], notes: [] };
    expect(trackChanges(emptySyncState('u'), base, removed, T(1)).goneNotebooks.nb1).toBe(T(1));
  });
});

describe('mergeRemote', () => {
  const empty = { notebooks: [] as Notebook[], notes: [] as Note[] };

  it('adds what the server has and we lack (a new device)', () => {
    const r = mergeRemote(
      empty,
      emptySyncState('u'),
      { notebooks: [nbRow('nb1')], notes: [noteRow('a', { title: 'Hello', body: 'World', pinned: true })] },
      { full: true, now: T(9) },
    );
    expect(r.local.notebooks.map((b) => b.id)).toEqual(['nb1']);
    expect(r.local.notes[0]).toMatchObject({ id: 'a', title: 'Hello', body: 'World', pinned: true });
    expect(r.changed).toBe(true);
    expect(r.state.revNotes.a).toBe(T(5));
    expect(pendingCount(r.state)).toBe(0);
  });

  it('a full pull marks never-uploaded local items dirty (first sign-in claims guest-era data)', () => {
    const local = { notebooks: [nb('nb1')], notes: [note('a')] };
    const r = mergeRemote(local, emptySyncState('u'), { notebooks: [], notes: [] }, { full: true, now: T(9) });
    expect(r.state.dirtyNotebooks.nb1).toBe(T(9));
    expect(r.state.dirtyNotes.a).toBe(T(9));
  });

  it('a partial update never infers "not uploaded"', () => {
    const local = { notebooks: [nb('nb1')], notes: [note('a')] };
    const r = mergeRemote(local, emptySyncState('u'), { notebooks: [], notes: [noteRow('z')] }, { full: false, now: T(9) });
    expect(r.state.dirtyNotes.a).toBeUndefined();
  });

  it('a newer server edit replaces a clean local note; an older echo is ignored', () => {
    const local = { notebooks: [nb('nb1')], notes: [note('a', { title: 'old' })] };
    const s0 = { ...emptySyncState('u'), revNotes: { a: T(3) } };
    const newerEdit = mergeRemote(local, s0, { notebooks: [], notes: [noteRow('a', { title: 'new', modified_at: T(8) })] }, { full: false, now: T(9) });
    expect(newerEdit.local.notes[0]?.title).toBe('new');
    const echo = mergeRemote(local, s0, { notebooks: [], notes: [noteRow('a', { title: 'stale', modified_at: T(2) })] }, { full: false, now: T(9) });
    expect(echo.local.notes[0]?.title).toBe('old');
    expect(echo.changed).toBe(false);
  });

  it('conflict: whichever edit is later wins', () => {
    const local = { notebooks: [nb('nb1')], notes: [note('a', { title: 'mine' })] };
    const mineLater = { ...emptySyncState('u'), dirtyNotes: { a: T(20) } };
    const keep = mergeRemote(local, mineLater, { notebooks: [], notes: [noteRow('a', { title: 'theirs', modified_at: T(10) })] }, { full: false, now: T(30) });
    expect(keep.local.notes[0]?.title).toBe('mine');
    expect(keep.state.dirtyNotes.a).toBe(T(20)); // still to upload

    const theirsLater = { ...emptySyncState('u'), dirtyNotes: { a: T(10) } };
    const take = mergeRemote(
      local,
      theirsLater,
      { notebooks: [], notes: [noteRow('a', { title: 'theirs', modified_at: T(20) })] },
      { full: false, now: T(30) },
    );
    expect(take.local.notes[0]?.title).toBe('theirs');
    expect(take.state.dirtyNotes.a).toBeUndefined();
  });

  it('restores a note we already "saw" if the local copy has gone (cleared storage, reset)', () => {
    const s = { ...emptySyncState('u'), revNotes: { a: T(5) }, revNotebooks: { nb1: T(5) } };
    const r = mergeRemote({ notebooks: [], notes: [] }, s, { notebooks: [nbRow('nb1')], notes: [noteRow('a', { title: 'back' })] }, { full: true, now: T(9) });
    expect(r.local.notebooks.map((b) => b.id)).toEqual(['nb1']);
    expect(r.local.notes[0]?.title).toBe('back');
  });

  it('keeps the local-only assignee when a note is updated from the server', () => {
    const local = { notebooks: [nb('nb1')], notes: [note('a', { assigneeId: 'alex' })] };
    const r = mergeRemote(local, emptySyncState('u'), { notebooks: [], notes: [noteRow('a', { title: 'x', modified_at: T(8) })] }, { full: false, now: T(9) });
    expect(r.local.notes[0]).toMatchObject({ title: 'x', assigneeId: 'alex' });
  });

  it('a server tombstone removes the local note (a deletion made on another device)', () => {
    const local = { notebooks: [nb('nb1')], notes: [note('a'), note('b')] };
    const r = mergeRemote(
      local,
      emptySyncState('u'),
      { notebooks: [], notes: [noteRow('a', { deleted_at: T(7), modified_at: T(7) })] },
      { full: false, now: T(9) },
    );
    expect(r.local.notes.map((n) => n.id)).toEqual(['b']);
    expect(r.changed).toBe(true);
  });

  it('…unless we edited it after it was deleted', () => {
    const local = { notebooks: [nb('nb1')], notes: [note('a', { title: 'revived' })] };
    const s = { ...emptySyncState('u'), dirtyNotes: { a: T(20) } };
    const r = mergeRemote(local, s, { notebooks: [], notes: [noteRow('a', { deleted_at: T(7), modified_at: T(7) })] }, { full: false, now: T(30) });
    expect(r.local.notes.map((n) => n.id)).toEqual(['a']);
  });

  it('our own pending deletion is not undone by an older server copy, but a later edit elsewhere revives it', () => {
    const local = { notebooks: [nb('nb1')], notes: [] as Note[] };
    const s = { ...emptySyncState('u'), goneNotes: { a: T(10) } };
    const old = mergeRemote(local, s, { notebooks: [], notes: [noteRow('a', { modified_at: T(5) })] }, { full: false, now: T(30) });
    expect(old.local.notes).toHaveLength(0);
    expect(old.state.goneNotes.a).toBe(T(10));
    const later = mergeRemote(local, s, { notebooks: [], notes: [noteRow('a', { modified_at: T(15) })] }, { full: false, now: T(30) });
    expect(later.local.notes.map((n) => n.id)).toEqual(['a']);
    expect(later.state.goneNotes.a).toBeUndefined();
  });

  it('a deleted notebook takes its notes with it; orphan notes are not resurrected', () => {
    const local = { notebooks: [nb('nb1'), nb('nb2')], notes: [note('a', { notebookId: 'nb2' })] };
    const r = mergeRemote(
      local,
      emptySyncState('u'),
      { notebooks: [nbRow('nb2', { deleted_at: T(7), modified_at: T(7) })], notes: [noteRow('orphan', { notebook_id: 'nb2' })] },
      { full: false, now: T(9) },
    );
    expect(r.local.notebooks.map((b) => b.id)).toEqual(['nb1']);
    expect(r.local.notes).toHaveLength(0);
  });

  it('never lets the notebook counter go backwards (note numbers stay unique)', () => {
    const local = { notebooks: [nb('nb1', { nextNumber: 9 })], notes: [] as Note[] };
    const r = mergeRemote(
      local,
      emptySyncState('u'),
      { notebooks: [nbRow('nb1', { next_number: 4, name: 'Renamed', modified_at: T(8) })], notes: [] },
      { full: false, now: T(9) },
    );
    expect(r.local.notebooks[0]).toMatchObject({ name: 'Renamed', nextNumber: 9 });
  });

  it('advances the cursor to the newest modified_at seen', () => {
    const r = mergeRemote(
      empty,
      emptySyncState('u'),
      { notebooks: [nbRow('nb1', { modified_at: T(4) })], notes: [noteRow('a', { modified_at: T(12) })] },
      { full: true, now: T(9) },
    );
    expect(r.state.cursor).toBe(T(12));
  });
});
