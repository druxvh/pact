import { describe, expect, it, vi } from 'vitest';
import { emptySyncState, LIMITS, ownKey, pendingCount, type SyncState, trackChanges } from '@/features/notes/sync/model';
import { AccountChanged, classifyError, type SendError, type UploadDeps, UploadFailure, uploadPending } from '@/features/notes/sync/uploader';
import type { Note, Notebook } from '@/features/notes/types';

const T = (n: number) => new Date(Date.UTC(2026, 10, 16, 12, 0, n)).toISOString();
const nb = (id: string): Notebook => ({ id, name: id, memberIds: ['local-user'], nextNumber: 1, createdAt: T(0) });
const note = (id: string, over: Partial<Note> = {}): Note => ({
  id,
  notebookId: 'nb1',
  number: 1,
  title: id,
  body: id,
  pinned: false,
  assigneeId: null,
  createdAt: T(0),
  updatedAt: T(0),
  ...over,
});

type Sent = { table: string; rows: Array<Record<string, unknown>> };

/** A tiny in-memory "app + server": the local store, the bookkeeping, and a fake upsert endpoint. */
function setup(initial: { notes: Note[]; dirty: Record<string, string>; chunk?: number; stamp?: SyncState }) {
  const app = { notebooks: [nb('nb1')], notes: initial.notes };
  let state: SyncState = { ...(initial.stamp ?? emptySyncState('u')), dirtyNotebooks: { nb1: T(1) }, dirtyNotes: initial.dirty };
  const sent: Sent[] = [];
  const serverRows = new Map<string, Record<string, unknown>>();
  const ownWrites = new Set<string>();
  const hooks = { onUpsert: undefined as undefined | ((s: Sent) => void), reject: (_s: Sent): SendError | null => null, guard: () => {} };
  const deps: UploadDeps = {
    owner: 'u',
    local: () => ({ notebooks: app.notebooks, notes: app.notes }),
    state: () => state,
    setState: (s) => {
      state = s;
    },
    guard: () => hooks.guard(),
    ownWrites,
    chunk: initial.chunk,
    onQuarantine: vi.fn(),
    upsert: async (table, rows) => {
      const s = { table, rows };
      sent.push(s);
      await Promise.resolve();
      hooks.onUpsert?.(s);
      const err = hooks.reject(s);
      if (err) return err;
      for (const r of rows) serverRows.set(`${table}:${String(r.id)}`, r);
      return null;
    },
    softDelete: vi.fn(async () => null),
  };
  /** The user edits a note while a request is in flight (the store changes and the engine's subscriber records it). */
  const edit = (id: string, body: string, at: string) => {
    const prev = { notebooks: app.notebooks, notes: app.notes };
    app.notes = app.notes.map((n) => (n.id === id ? { ...n, body, updatedAt: at } : n));
    state = trackChanges(state, prev, { notebooks: app.notebooks, notes: app.notes }, at);
  };
  return { app, deps, sent, serverRows, ownWrites, hooks, edit, state: () => state };
}

describe('uploadPending', () => {
  it('sends notebooks before notes, then clears what was dirty and remembers the server stamps', async () => {
    const t = setup({ notes: [note('a'), note('b')], dirty: { a: T(2), b: T(3) } });
    await uploadPending(t.deps);
    expect(t.sent.map((s) => s.table)).toEqual(['notebooks', 'notes']);
    expect(t.sent[1]?.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(t.sent[1]?.rows[0]).toMatchObject({ owner_id: 'u', modified_at: T(2), deleted_at: null });
    expect(pendingCount(t.state())).toBe(0);
    expect(t.state().revNotes).toEqual({ a: T(2), b: T(3) });
    expect(t.ownWrites.has(ownKey('note', 'a', T(2)))).toBe(true);
  });

  describe('never sends a stale snapshot', () => {
    it('an edit made while an EARLIER chunk is in flight goes out as the new text, not the old text under the new stamp', async () => {
      const t = setup({ notes: [note('a'), note('b')], dirty: { a: T(2), b: T(3) }, chunk: 1 });
      // notebook request, then note "a" in its own chunk — while "a" is in flight the user edits "b"
      t.hooks.onUpsert = (s) => {
        if (s.table === 'notes' && s.rows[0]?.id === 'a') t.edit('b', 'b EDITED', T(10));
      };
      await uploadPending(t.deps);
      const bRows = t.sent.filter((s) => s.table === 'notes' && s.rows[0]?.id === 'b').flatMap((s) => s.rows);
      expect(bRows).toHaveLength(1);
      expect(bRows[0]).toMatchObject({ body: 'b EDITED', modified_at: T(10) }); // text and stamp belong together
      expect(t.serverRows.get('notes:b')).toMatchObject({ body: 'b EDITED' });
      expect(pendingCount(t.state())).toBe(0);
    });

    it('an edit made while a note is itself in flight keeps it dirty, so the newer text uploads next', async () => {
      const t = setup({ notes: [note('a')], dirty: { a: T(2) } });
      t.hooks.onUpsert = (s) => {
        if (s.table === 'notes') t.edit('a', 'a EDITED', T(10));
      };
      await uploadPending(t.deps);
      expect(t.state().dirtyNotes.a).toBe(T(10)); // not cleared: the stamp changed under the request
      expect(t.serverRows.get('notes:a')).toMatchObject({ body: 'a' }); // the server has the older text so far…
      t.hooks.onUpsert = undefined;
      await uploadPending(t.deps);
      expect(t.serverRows.get('notes:a')).toMatchObject({ body: 'a EDITED', modified_at: T(10) }); // …and then the newer one
      expect(pendingCount(t.state())).toBe(0);
    });
  });

  describe('one bad note cannot block the rest', () => {
    it('a note over the size limit is set aside before sending, and everything else syncs', async () => {
      const big = note('big', { body: 'x'.repeat(LIMITS.body + 1) });
      const t = setup({ notes: [note('a'), big, note('b')], dirty: { a: T(2), big: T(3), b: T(4) } });
      await uploadPending(t.deps);
      expect(t.sent.flatMap((s) => (s.table === 'notes' ? s.rows.map((r) => r.id) : []))).toEqual(['a', 'b']);
      expect(t.state().localOnlyNotes.big).toMatchObject({ reason: 'too-large' });
      expect(pendingCount(t.state())).toBe(0);
      expect(t.deps.onQuarantine).toHaveBeenCalledWith([expect.objectContaining({ id: 'big', reason: 'too-large' })]);
    });

    it('a batch the server refuses for one row is split until only that row is set aside', async () => {
      const notes = Array.from({ length: 9 }, (_, i) => note(`n${i}`));
      const t = setup({ notes, dirty: Object.fromEntries(notes.map((n, i) => [n.id, T(2 + i)])) });
      t.hooks.reject = (s) => (s.rows.some((r) => r.id === 'n4') ? { kind: 'permanent', message: 'violates check constraint' } : null);
      await uploadPending(t.deps);
      expect([...t.serverRows.keys()].filter((k) => k.startsWith('notes:')).sort()).toEqual(
        notes
          .filter((n) => n.id !== 'n4')
          .map((n) => `notes:${n.id}`)
          .sort(),
      );
      expect(t.state().localOnlyNotes.n4).toMatchObject({ reason: 'rejected' });
      expect(t.state().dirtyNotes).toEqual({});
      expect(t.sent.length).toBeLessThan(20); // bisecting, not one request per note
      expect(t.deps.onQuarantine).toHaveBeenCalledWith([expect.objectContaining({ id: 'n4', reason: 'rejected' })]);
    });

    it('a failure that is not about the rows (network, server, schema) is retried later and quarantines nothing', async () => {
      for (const err of [
        { kind: 'transient', message: 'Failed to fetch' },
        { kind: 'auth', message: 'JWT expired' },
      ] as const) {
        const t = setup({ notes: [note('a'), note('b')], dirty: { a: T(2), b: T(3) } });
        t.hooks.reject = (s) => (s.table === 'notes' ? err : null);
        await expect(uploadPending(t.deps)).rejects.toBeInstanceOf(UploadFailure);
        expect(t.state().dirtyNotes).toEqual({ a: T(2), b: T(3) });
        expect(t.state().localOnlyNotes).toEqual({});
      }
    });
  });

  it('checks the account before every request and sends nothing once it has changed', async () => {
    const t = setup({ notes: [note('a')], dirty: { a: T(2) } });
    let calls = 0;
    t.hooks.guard = () => {
      if (++calls > 2) throw new AccountChanged(); // fine for the first request, then another tab signs in as someone else
    };
    await expect(uploadPending(t.deps)).rejects.toBeInstanceOf(AccountChanged);
    expect(t.sent.map((s) => s.table)).toEqual(['notebooks']); // the notes were never sent
    expect(t.state().dirtyNotes.a).toBe(T(2));
  });

  it('sends nothing at all if the account is already wrong', async () => {
    const t = setup({ notes: [note('a')], dirty: { a: T(2) } });
    t.hooks.guard = () => {
      throw new AccountChanged();
    };
    await expect(uploadPending(t.deps)).rejects.toBeInstanceOf(AccountChanged);
    expect(t.sent).toHaveLength(0);
  });

  describe('deletions', () => {
    it('are reported with their stamp and cleared when acknowledged', async () => {
      const t = setup({ notes: [], dirty: {} });
      t.deps.setState({ ...t.state(), dirtyNotebooks: {}, goneNotes: { x: T(5), y: T(7) } });
      await uploadPending(t.deps);
      expect(t.deps.softDelete).toHaveBeenCalledWith('notes', ['x', 'y'], T(7));
      expect(t.state().goneNotes).toEqual({});
      expect(t.state().revNotes).toEqual({ x: T(7), y: T(7) });
    });

    it('a failed report is retried, not forgotten', async () => {
      const t = setup({ notes: [], dirty: {} });
      t.deps.setState({ ...t.state(), dirtyNotebooks: {}, goneNotes: { x: T(5) } });
      (t.deps.softDelete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ kind: 'transient', message: 'offline' });
      await expect(uploadPending(t.deps)).rejects.toBeInstanceOf(UploadFailure);
      expect(t.state().goneNotes).toEqual({ x: T(5) });
    });
  });
});

describe('classifyError', () => {
  it('blames the row only for data / integrity / limit errors', () => {
    expect(classifyError(null)).toBeNull();
    expect(classifyError({ code: '23514', message: 'check' })?.kind).toBe('permanent');
    expect(classifyError({ code: '22001', message: 'too long' })?.kind).toBe('permanent');
    expect(classifyError({ code: '23503', message: 'fk' })?.kind).toBe('permanent');
    expect(classifyError({ message: 'too big', status: 413 })?.kind).toBe('permanent');
    expect(classifyError({ code: '42501', message: 'rls' })?.kind).toBe('auth');
    expect(classifyError({ message: 'JWT expired', status: 401 })?.kind).toBe('auth');
    expect(classifyError({ code: '', message: 'TypeError: Failed to fetch' })?.kind).toBe('transient');
    expect(classifyError({ code: 'PGRST204', message: 'column missing' })?.kind).toBe('transient');
    expect(classifyError({ message: 'x', status: 503 })?.kind).toBe('transient');
  });
});
