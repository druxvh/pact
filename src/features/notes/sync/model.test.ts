import { describe, expect, it } from 'vitest';
import type { Note, Notebook } from '@/features/notes/types';
import {
  ackDeleted,
  ackUpload,
  buildNoteBatch,
  buildNotebookBatch,
  checkNote,
  conflictCopyId,
  conflictTitle,
  emptySyncState,
  LIMITS,
  localOnlyCount,
  mergeRemote,
  type NotebookRow,
  type NoteRow,
  normalizeSyncState,
  notebookToRow,
  noteToRow,
  ownKey,
  pendingCount,
  quarantineRejected,
  RECOVERED_NOTEBOOK_ID,
  trackChanges,
} from './model';

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

// ── conflicts: nothing is silently dropped ───────────────────────────────────

describe('conflict copies (edit / edit)', () => {
  const local = (over: Partial<Note> = {}) => ({ notebooks: [nb('nb1')], notes: [note('a', { title: 'Plan', body: 'mine', updatedAt: T(20), ...over })] });
  /** We saw the server's version at T(3); then we edited (T(20)) while the server moved on (modified_at below). */
  const state = (extra = {}) => ({ ...emptySyncState('u'), revNotes: { a: T(3) }, dirtyNotes: { a: T(20) }, ...extra });
  const opts = { full: false, now: T(40), label: () => 'Nov 16' };

  it('server later: the server version stays as the note, ours becomes "Plan (conflict copy, …)" in the same notebook', () => {
    const r = mergeRemote(local(), state(), { notebooks: [], notes: [noteRow('a', { title: 'Plan', body: 'theirs', modified_at: T(30) })] }, opts);
    const kept = r.local.notes.find((n) => n.id === 'a');
    const copy = r.local.notes.find((n) => n.id !== 'a');
    expect(kept).toMatchObject({ title: 'Plan', body: 'theirs' });
    expect(copy).toMatchObject({ title: 'Plan (conflict copy, Nov 16)', body: 'mine', notebookId: 'nb1', pinned: false });
    expect(r.state.dirtyNotes.a).toBeUndefined(); // the note is now what the server has
    expect(r.state.dirtyNotes[copy?.id as string]).toBe(T(40)); // the copy still has to upload
    expect(r.state.revNotes.a).toBe(T(30));
    expect(r.conflicts).toEqual([expect.objectContaining({ kind: 'copy', noteId: 'a', copyIs: 'local', copyTitle: 'Plan (conflict copy, Nov 16)' })]);
    expect(r.changed).toBe(true);
  });

  it('ours later: ours stays the note (and re-uploads), the server version is kept as the copy', () => {
    const r = mergeRemote(
      local(),
      state({ dirtyNotes: { a: T(35) } }),
      { notebooks: [], notes: [noteRow('a', { title: 'Plan', body: 'theirs', modified_at: T(30) })] },
      opts,
    );
    expect(r.local.notes.find((n) => n.id === 'a')?.body).toBe('mine');
    expect(r.local.notes.find((n) => n.id !== 'a')).toMatchObject({ title: 'Plan (conflict copy, Nov 16)', body: 'theirs' });
    expect(r.state.dirtyNotes.a).toBe(T(35)); // still to upload, over the server's copy
    expect(r.state.revNotes.a).toBe(T(30)); // we have now seen the server's version
    expect(r.conflicts[0]).toMatchObject({ kind: 'copy', copyIs: 'remote' });
  });

  it('a tie goes to the server', () => {
    const r = mergeRemote(
      local(),
      state({ dirtyNotes: { a: T(30) } }),
      { notebooks: [], notes: [noteRow('a', { title: 'Plan', body: 'theirs', modified_at: T(30) })] },
      opts,
    );
    expect(r.local.notes.find((n) => n.id === 'a')?.body).toBe('theirs');
  });

  it('is not a conflict when both sides made the same edit', () => {
    const r = mergeRemote(local(), state(), { notebooks: [], notes: [noteRow('a', { title: 'Plan', body: 'mine', modified_at: T(30) })] }, opts);
    expect(r.local.notes).toHaveLength(1);
    expect(r.conflicts).toEqual([]);
    expect(r.state.dirtyNotes.a).toBeUndefined();
  });

  it('a pin on one side and an edit of the text elsewhere: only the pin differs → the later change wins, no copy', () => {
    const l = local({ pinned: true, body: 'same' });
    const r = mergeRemote(l, state(), { notebooks: [], notes: [noteRow('a', { title: 'Plan', body: 'same', pinned: false, modified_at: T(30) })] }, opts);
    expect(r.local.notes).toHaveLength(1);
    expect(r.local.notes[0]?.pinned).toBe(false);
    expect(r.conflicts).toEqual([]);
  });

  it('our own upload echoing back (Realtime beats the HTTP response) is not a conflict', () => {
    const own = new Set([ownKey('note', 'a', T(20))]);
    const r = mergeRemote(
      local(),
      state(),
      { notebooks: [], notes: [noteRow('a', { title: 'Plan', body: 'mine', modified_at: T(20) })] },
      { ...opts, ownWrites: own },
    );
    expect(r.local.notes).toHaveLength(1);
    expect(r.conflicts).toEqual([]);
    expect(r.state.revNotes.a).toBe(T(20));
    expect(r.state.dirtyNotes.a).toBe(T(20)); // untouched: if it changed since, it still has to upload
  });

  it('an older echo of our own write is ignored even if we have edited again since', () => {
    const own = new Set([ownKey('note', 'a', T(10))]);
    const l = local({ body: 'edited again' });
    const r = mergeRemote(
      l,
      state({ dirtyNotes: { a: T(25) }, revNotes: { a: T(3) } }),
      { notebooks: [], notes: [noteRow('a', { body: 'earlier upload', modified_at: T(10) })] },
      { ...opts, ownWrites: own },
    );
    expect(r.local.notes).toHaveLength(1);
    expect(r.local.notes[0]?.body).toBe('edited again');
  });

  it('merging the same server row twice never makes a second copy', () => {
    const row = noteRow('a', { title: 'Plan', body: 'theirs', modified_at: T(30) });
    const first = mergeRemote(local(), state(), { notebooks: [], notes: [row] }, opts);
    const second = mergeRemote(first.local, first.state, { notebooks: [], notes: [row] }, opts);
    expect(second.local.notes).toHaveLength(2);
    expect(second.conflicts).toEqual([]);
  });

  it('the copy takes the next #number of its notebook and bumps the counter so it syncs', () => {
    const l = { notebooks: [nb('nb1', { nextNumber: 7 })], notes: [note('a', { body: 'mine', updatedAt: T(20) })] };
    const r = mergeRemote(l, state(), { notebooks: [], notes: [noteRow('a', { body: 'theirs', modified_at: T(30) })] }, opts);
    expect(r.local.notes.find((n) => n.id !== 'a')?.number).toBe(7);
    expect(r.local.notebooks[0]?.nextNumber).toBe(8);
    expect(r.state.dirtyNotebooks.nb1).toBe(T(40));
  });

  it('copy titles stay within the server limit, and copy ids within 64 characters', () => {
    const title = conflictTitle('x'.repeat(600), 'Nov 16');
    expect(Array.from(title).length).toBeLessThanOrEqual(LIMITS.title);
    expect(title.endsWith('(conflict copy, Nov 16)')).toBe(true);
    expect(conflictTitle('  ', 'Nov 16')).toBe('Untitled (conflict copy, Nov 16)');
    expect(conflictCopyId('n'.repeat(64), T(5)).length).toBeLessThanOrEqual(LIMITS.id);
  });

  it('an unknown base (bookkeeping was reset) still keeps both sides when we have unsynced edits', () => {
    const r = mergeRemote(
      local(),
      { ...emptySyncState('u'), dirtyNotes: { a: T(20) } },
      { notebooks: [], notes: [noteRow('a', { body: 'theirs', modified_at: T(30) })] },
      opts,
    );
    expect(r.local.notes).toHaveLength(2);
  });
});

describe('edit / delete: the edit is kept', () => {
  const opts = { full: false, now: T(40) };

  it('edited here, deleted elsewhere — even if the delete is later — the note is resurrected with a fresh stamp', () => {
    const l = { notebooks: [nb('nb1')], notes: [note('a', { title: 'mine', updatedAt: T(5) })] };
    const s = { ...emptySyncState('u'), revNotes: { a: T(3) }, dirtyNotes: { a: T(5) } };
    const r = mergeRemote(l, s, { notebooks: [], notes: [noteRow('a', { deleted_at: T(30), modified_at: T(30) })] }, opts);
    expect(r.local.notes.map((n) => n.id)).toEqual(['a']);
    expect(r.state.dirtyNotes.a).toBe(T(40)); // newer than the tombstone, so everyone ends up with the edit
    expect(r.state.revNotes.a).toBe(T(30));
    expect(r.conflicts).toEqual([expect.objectContaining({ kind: 'kept-edit', why: 'deleted-elsewhere', noteId: 'a' })]);
  });

  it('deleted here, edited elsewhere — the edit comes back (we saw an older version, so the edit is news to us)', () => {
    const l = { notebooks: [nb('nb1')], notes: [] as Note[] };
    const s = { ...emptySyncState('u'), revNotes: { a: T(3) }, goneNotes: { a: T(20) } };
    // the server edit is *older* than our deletion by the clock — but we never saw it, so it must not be lost
    const r = mergeRemote(l, s, { notebooks: [], notes: [noteRow('a', { title: 'their edit', modified_at: T(10) })] }, opts);
    expect(r.local.notes).toEqual([expect.objectContaining({ id: 'a', title: 'their edit' })]);
    expect(r.state.goneNotes.a).toBeUndefined();
    expect(r.conflicts).toEqual([expect.objectContaining({ kind: 'kept-edit', why: 'edited-elsewhere' })]);
  });

  it('deleted on both sides is simply deleted (nothing to report)', () => {
    const l = { notebooks: [nb('nb1')], notes: [] as Note[] };
    const s = { ...emptySyncState('u'), revNotes: { a: T(3) }, goneNotes: { a: T(20) } };
    const r = mergeRemote(l, s, { notebooks: [], notes: [noteRow('a', { deleted_at: T(25), modified_at: T(25) })] }, opts);
    expect(r.local.notes).toHaveLength(0);
    expect(r.state.goneNotes.a).toBeUndefined();
    expect(r.conflicts).toEqual([]);
  });

  it('a note whose notebook was deleted here but edited elsewhere is rescued into a "Recovered notes" notebook', () => {
    const l = { notebooks: [nb('nb1')], notes: [] as Note[] };
    const s = { ...emptySyncState('u'), revNotes: { a: T(3) }, goneNotes: { a: T(20) } };
    const r = mergeRemote(l, s, { notebooks: [], notes: [noteRow('a', { notebook_id: 'nb-deleted-here', title: 'their edit', modified_at: T(10) })] }, opts);
    expect(r.local.notebooks.map((b) => b.id)).toContain(RECOVERED_NOTEBOOK_ID);
    expect(r.local.notes[0]).toMatchObject({ id: 'a', notebookId: RECOVERED_NOTEBOOK_ID });
    expect(r.state.dirtyNotes.a).toBe(T(40));
    expect(r.state.dirtyNotebooks[RECOVERED_NOTEBOOK_ID]).toBe(T(40));
  });

  it('a notebook deleted elsewhere keeps (and re-uploads) the notes we still have unsynced edits in', () => {
    const l = { notebooks: [nb('nb1'), nb('nb2')], notes: [note('keep', { notebookId: 'nb2' }), note('clean', { notebookId: 'nb2' })] };
    const s = { ...emptySyncState('u'), dirtyNotes: { keep: T(20) } };
    const r = mergeRemote(l, s, { notebooks: [nbRow('nb2', { deleted_at: T(30), modified_at: T(30) })], notes: [] }, opts);
    expect(r.local.notebooks.map((b) => b.id)).toEqual(['nb1', 'nb2']);
    expect(r.local.notes.map((n) => n.id)).toEqual(['keep']);
    expect(r.state.dirtyNotebooks.nb2).toBe(T(40));
    expect(r.conflicts).toEqual([expect.objectContaining({ kind: 'kept-edit', why: 'notebook-deleted-elsewhere', noteId: 'keep' })]);
  });
});

describe('offline → online merge', () => {
  it('a backlog of edits, deletions and new notes merges note by note with nothing lost', () => {
    // Offline we: edited A (conflicts), edited B (server untouched), deleted C (server untouched), created D.
    // Meanwhile the server: edited A and E, never touched B, C.
    const l = {
      notebooks: [nb('nb1')],
      notes: [note('a', { body: 'A mine', updatedAt: T(20) }), note('b', { body: 'B mine', updatedAt: T(21) }), note('d', { body: 'D new' })],
    };
    const s = {
      ...emptySyncState('u'),
      revNotes: { a: T(3), b: T(3), c: T(3), e: T(3) },
      dirtyNotes: { a: T(20), b: T(21), d: T(22) },
      goneNotes: { c: T(23) },
    };
    const r = mergeRemote(
      l,
      s,
      { notebooks: [], notes: [noteRow('a', { body: 'A theirs', modified_at: T(30) }), noteRow('e', { body: 'E theirs', modified_at: T(31) })] },
      { full: false, now: T(40) },
    );
    const byId = Object.fromEntries(r.local.notes.map((n) => [n.id, n]));
    expect(byId.a?.body).toBe('A theirs');
    expect(r.local.notes.some((n) => n.title.startsWith('a (conflict copy') && n.body === 'A mine')).toBe(true);
    expect(byId.b?.body).toBe('B mine');
    expect(byId.d?.body).toBe('D new');
    expect(byId.e?.body).toBe('E theirs');
    expect(byId.c).toBeUndefined();
    expect(r.state.dirtyNotes.b).toBe(T(21));
    expect(r.state.dirtyNotes.d).toBe(T(22));
    expect(r.state.goneNotes.c).toBe(T(23));
  });
});

// ── size limits ──────────────────────────────────────────────────────────────

describe('what the server would refuse', () => {
  it('flags titles and bodies over the table limits, counting characters the way Postgres does', () => {
    expect(checkNote(note('a'))).toBeNull();
    expect(checkNote(note('a', { body: 'x'.repeat(LIMITS.body) }))).toBeNull();
    expect(checkNote(note('a', { body: 'x'.repeat(LIMITS.body + 1) }))?.reason).toBe('too-large');
    expect(checkNote(note('a', { title: 'x'.repeat(LIMITS.title + 1) }))?.reason).toBe('too-large');
    // an emoji is 2 UTF-16 units but ONE character: this body is 400,000 characters, within the limit
    expect(checkNote(note('a', { body: '😀'.repeat(400_000) }))).toBeNull();
    expect(checkNote(note('a', { body: '😀'.repeat(500_001) }))?.reason).toBe('too-large');
    expect(checkNote(note('x'.repeat(65)))?.reason).toBe('rejected');
  });

  it('NUL characters (which Postgres text refuses) are stripped from the row, not sent', () => {
    expect(noteToRow(note('a', { title: 'a\u0000b', body: 'x\u0000y' }), T(1))).toMatchObject({ title: 'ab', body: 'xy' });
  });

  const big = note('big', { body: 'x'.repeat(LIMITS.body + 1) });
  const local = { notebooks: [nb('nb1')], notes: [note('ok1'), big, note('ok2')] };
  const dirty = { ...emptySyncState('u'), dirtyNotes: { ok1: T(1), big: T(2), ok2: T(3) } };

  it('buildNoteBatch sets the oversized note aside and still sends the rest', () => {
    const b = buildNoteBatch(local, dirty, ['ok1', 'big', 'ok2']);
    expect(b.rows.map((r) => r.id)).toEqual(['ok1', 'ok2']);
    expect(b.quarantined).toEqual([expect.objectContaining({ id: 'big', reason: 'too-large' })]);
    expect(b.state.dirtyNotes.big).toBeUndefined();
    expect(b.state.localOnlyNotes.big).toMatchObject({ reason: 'too-large', at: T(2) });
    expect(pendingCount(b.state)).toBe(2); // the local-only note is not "pending" — it would wait forever
    expect(localOnlyCount(b.state)).toBe(1);
  });

  it('a local-only note that is edited back under the limit uploads again', () => {
    const q = buildNoteBatch(local, dirty, ['big']).state;
    const fixed = { notebooks: local.notebooks, notes: [{ ...big, body: 'short now' }] };
    const edited = trackChanges(q, local, fixed, T(9));
    const b = buildNoteBatch(fixed, edited, ['big']);
    expect(b.rows.map((r) => r.id)).toEqual(['big']);
    expect(b.state.localOnlyNotes.big).toBeUndefined();
  });

  it('deleting a local-only note forgets it', () => {
    const q = buildNoteBatch(local, dirty, ['big']).state;
    const gone = trackChanges(q, local, { notebooks: local.notebooks, notes: [note('ok1'), note('ok2')] }, T(9));
    expect(gone.localOnlyNotes.big).toBeUndefined();
    expect(gone.goneNotes.big).toBe(T(9));
  });

  it('a server edit to a local-only note is a conflict (we hold unsynced edits), not a silent overwrite', () => {
    const q = buildNoteBatch(local, dirty, ['big']).state;
    const r = mergeRemote(
      local,
      { ...q, revNotes: { big: T(1) } },
      { notebooks: [], notes: [noteRow('big', { body: 'server text', modified_at: T(30) })] },
      { full: false, now: T(40) },
    );
    expect(r.local.notes.find((n) => n.id === 'big')?.body).toBe('server text');
    const copy = r.local.notes.find((n) => n.title.includes('conflict copy'));
    expect(copy?.body.length).toBe(LIMITS.body + 1); // our big text survives as a copy
  });

  it("a note in a notebook that can't sync stays local too — until the notebook is fixed", () => {
    const longName = 'n'.repeat(LIMITS.notebookName + 1);
    const l = { notebooks: [nb('nbBig', { name: longName })], notes: [note('inside', { notebookId: 'nbBig' })] };
    const s = { ...emptySyncState('u'), dirtyNotebooks: { nbBig: T(1) }, dirtyNotes: { inside: T(2) } };
    const nbBatch = buildNotebookBatch(l, s, ['nbBig']);
    expect(nbBatch.quarantined[0]).toMatchObject({ kind: 'notebook', reason: 'too-large' });
    const noteBatch = buildNoteBatch(l, nbBatch.state, ['inside']);
    expect(noteBatch.rows).toHaveLength(0);
    expect(noteBatch.state.localOnlyNotes.inside).toMatchObject({ reason: 'notebook', notebookId: 'nbBig' });
    // rename the notebook shorter → it uploads, and its notes are queued again
    const fixed = { notebooks: [nb('nbBig', { name: 'ok' })], notes: l.notes };
    const again = buildNotebookBatch(fixed, { ...noteBatch.state, dirtyNotebooks: { nbBig: T(5) } }, ['nbBig']);
    expect(again.rows).toHaveLength(1);
    expect(again.state.localOnlyNotes.inside).toBeUndefined();
    expect(again.state.dirtyNotes.inside).toBe(T(2));
  });

  it('quarantineRejected moves a refused note out of the queue', () => {
    const s = quarantineRejected({ ...emptySyncState('u'), dirtyNotes: { a: T(1) } }, 'note', 'a', 'The server refused it: nope');
    expect(s.dirtyNotes.a).toBeUndefined();
    expect(s.localOnlyNotes.a).toMatchObject({ reason: 'rejected', at: T(1) });
  });
});

// ── acknowledging uploads ────────────────────────────────────────────────────

describe('acknowledging', () => {
  it('a sent note stops being dirty only if it was not edited again meanwhile', () => {
    const s = { ...emptySyncState('u'), dirtyNotes: { a: T(5), b: T(9) } };
    const after = ackUpload(s, 'note', [
      ['a', T(5)],
      ['b', T(6)], // b was sent at T(6) but has since been edited (dirty is T(9))
    ]);
    expect(after.dirtyNotes).toEqual({ b: T(9) });
    expect(after.revNotes).toEqual({ a: T(5), b: T(6) });
  });

  it('a reported deletion is cleared only if the note was not restored and deleted again meanwhile', () => {
    const s = { ...emptySyncState('u'), goneNotes: { a: T(5), b: T(9) } };
    const after = ackDeleted(
      s,
      'note',
      [
        ['a', T(5)],
        ['b', T(6)],
      ],
      T(9),
    );
    expect(after.goneNotes).toEqual({ b: T(9) });
  });
});

describe('normalizeSyncState', () => {
  it('reads an older record that lacks the newer fields, and ignores garbage', () => {
    const old = {
      owner: 'u',
      dirtyNotebooks: {},
      dirtyNotes: { a: T(1), b: 5 },
      goneNotebooks: {},
      goneNotes: {},
      revNotebooks: {},
      revNotes: {},
      cursor: null,
    };
    const s = normalizeSyncState(old);
    expect(s?.dirtyNotes).toEqual({ a: T(1) });
    expect(s?.localOnlyNotes).toEqual({});
    expect(normalizeSyncState('nope')).toBeNull();
    expect(normalizeSyncState({ localOnlyNotes: { x: { reason: 'weird', message: 'm', at: T(1) }, y: 3 } })?.localOnlyNotes).toEqual({
      x: { reason: 'rejected', message: 'm', at: T(1) },
    });
  });
});
