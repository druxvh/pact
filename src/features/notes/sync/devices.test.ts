/**
 * Two devices and one server, end to end through the real model and uploader (only the network is fake):
 * the scenarios where the old last-write-wins sync silently threw an edit away.
 */
import { describe, expect, it } from 'vitest';
import { emptySyncState, LIMITS, mergeRemote, type NotebookRow, type NoteRow, pendingCount, type SyncState, trackChanges } from '@/features/notes/sync/model';
import { uploadPending } from '@/features/notes/sync/uploader';
import type { Note, Notebook } from '@/features/notes/types';

type Row = (NoteRow | NotebookRow) & { owner_id?: string };

function world() {
  let t = 0;
  const clock = () => new Date(Date.UTC(2026, 10, 17, 12, 0, ++t)).toISOString();
  const tables: Record<'notes' | 'notebooks', Map<string, Row>> = { notes: new Map(), notebooks: new Map() };
  const server = {
    upsert: async (table: 'notes' | 'notebooks', rows: Array<Record<string, unknown>>) => {
      if (table === 'notes' && rows.some((r) => String(r.body).length > LIMITS.body))
        return { kind: 'permanent' as const, message: 'check constraint notes_body_length' };
      for (const r of rows) tables[table].set(String(r.id), r as unknown as Row);
      return null;
    },
    softDelete: async (table: 'notes' | 'notebooks', ids: string[], stamp: string) => {
      for (const id of ids) {
        const row = tables[table].get(id);
        if (row) tables[table].set(id, { ...row, deleted_at: stamp, modified_at: stamp });
      }
      return null;
    },
    since: (cursor: string | null) => ({
      notebooks: [...tables.notebooks.values()].filter((r) => !cursor || r.modified_at > cursor) as NotebookRow[],
      notes: [...tables.notes.values()].filter((r) => !cursor || r.modified_at > cursor) as NoteRow[],
    }),
  };

  function device() {
    let notebooks: Notebook[] = [{ id: 'nb1', name: 'Personal', memberIds: ['local-user'], nextNumber: 1, createdAt: clock() }];
    let notes: Note[] = [];
    let state: SyncState = emptySyncState('u');
    const own = new Set<string>();
    const conflicts: string[] = [];
    const apply = (next: { notebooks: Notebook[]; notes: Note[] }) => {
      const prev = { notebooks, notes };
      notebooks = next.notebooks;
      notes = next.notes;
      state = trackChanges(state, prev, next, clock());
    };
    return {
      get notes() {
        return notes;
      },
      get state() {
        return state;
      },
      conflicts,
      add(id: string, title: string, body: string) {
        const stamp = clock();
        apply({
          notebooks,
          notes: [
            ...notes,
            { id, notebookId: 'nb1', number: notes.length + 1, title, body, pinned: false, assigneeId: null, createdAt: stamp, updatedAt: stamp },
          ],
        });
      },
      edit(id: string, body: string) {
        apply({ notebooks, notes: notes.map((n) => (n.id === id ? { ...n, body, updatedAt: clock() } : n)) });
      },
      remove(id: string) {
        apply({ notebooks, notes: notes.filter((n) => n.id !== id) });
      },
      async sync() {
        const m = mergeRemote({ notebooks, notes }, state, server.since(state.cursor), {
          full: state.cursor === null,
          now: clock(),
          ownWrites: own,
          label: () => 'Nov 17',
        });
        state = m.state;
        notebooks = m.local.notebooks;
        notes = m.local.notes;
        conflicts.push(...m.conflicts.map((c) => `${c.kind}:${c.noteId}`));
        await uploadPending({
          owner: 'u',
          local: () => ({ notebooks, notes }),
          state: () => state,
          setState: (s) => {
            state = s;
          },
          guard: () => {},
          ownWrites: own,
          upsert: server.upsert,
          softDelete: server.softDelete,
        });
      },
    };
  }
  return { device, tables };
}

const bodies = (d: { notes: Note[] }) => d.notes.map((n) => `${n.title}|${n.body}`).sort();

/** Both devices sync until nothing is left to exchange. */
async function settle(...devices: Array<ReturnType<ReturnType<typeof world>['device']>>) {
  for (let i = 0; i < 3; i++) for (const d of devices) await d.sync();
}

describe('two devices, one server', () => {
  it('both edit the same note offline: nothing is lost, and both devices end up identical', async () => {
    const w = world();
    const a = w.device();
    const b = w.device();
    a.add('n1', 'Plan', 'v1');
    await settle(a, b);
    expect(bodies(b)).toEqual(['Plan|v1']);

    a.edit('n1', 'A was here'); // both go offline and edit…
    b.edit('n1', 'B was here');
    await a.sync(); // …A reconnects first
    await b.sync(); // …then B: its edit conflicts with what A already uploaded
    await settle(a, b);

    expect(bodies(a)).toEqual(bodies(b));
    const all = bodies(a).join('\n');
    expect(all).toContain('A was here');
    expect(all).toContain('B was here');
    expect(a.notes).toHaveLength(2);
    expect(a.notes.some((n) => n.title === 'Plan (conflict copy, Nov 17)')).toBe(true);
    expect(b.conflicts.length + a.conflicts.length).toBeGreaterThan(0);
    expect(pendingCount(a.state) + pendingCount(b.state)).toBe(0);
  });

  it('edit here, delete there: the edit survives on both devices (whoever syncs first)', async () => {
    for (const deleterFirst of [true, false]) {
      const w = world();
      const a = w.device();
      const b = w.device();
      a.add('n1', 'Plan', 'v1');
      await settle(a, b);
      a.edit('n1', 'important edit');
      b.remove('n1');
      if (deleterFirst) {
        await b.sync();
        await a.sync();
      } else {
        await a.sync();
        await b.sync();
      }
      await settle(a, b);
      expect(bodies(a), `deleterFirst=${deleterFirst}`).toEqual(['Plan|important edit']);
      expect(bodies(b), `deleterFirst=${deleterFirst}`).toEqual(['Plan|important edit']);
    }
  });

  it('a delete that nobody contested still deletes everywhere', async () => {
    const w = world();
    const a = w.device();
    const b = w.device();
    a.add('n1', 'Plan', 'v1');
    a.add('n2', 'Other', 'x');
    await settle(a, b);
    b.remove('n1');
    await settle(a, b);
    expect(bodies(a)).toEqual(['Other|x']);
    expect(bodies(b)).toEqual(['Other|x']);
  });

  it('an offline backlog on one device merges with changes on the other without losing either side', async () => {
    const w = world();
    const a = w.device();
    const b = w.device();
    a.add('n1', 'One', '1');
    a.add('n2', 'Two', '2');
    a.add('n3', 'Three', '3');
    await settle(a, b);
    // A offline: edits One, deletes Two, creates Four.  B online: edits One and Three, creates Five.
    a.edit('n1', 'one (A)');
    a.remove('n2');
    a.add('n4', 'Four', '4');
    b.edit('n1', 'one (B)');
    b.edit('n3', 'three (B)');
    b.add('n5', 'Five', '5');
    await b.sync();
    await a.sync();
    await settle(a, b);
    expect(bodies(a)).toEqual(bodies(b));
    const all = bodies(a);
    expect(all).toContain('Four|4');
    expect(all).toContain('Five|5');
    expect(all).toContain('Three|three (B)');
    expect(all).not.toContain('Two|2');
    expect(all.join('\n')).toContain('one (A)');
    expect(all.join('\n')).toContain('one (B)');
  });

  it('a note over the server limit is kept on its device, warns, and never blocks the rest', async () => {
    const w = world();
    const a = w.device();
    const b = w.device();
    a.add('small1', 'Small', 'a');
    a.add('huge', 'Huge', 'x'.repeat(LIMITS.body + 1));
    a.add('small2', 'Small too', 'b');
    await settle(a, b);
    expect(bodies(b)).toEqual(['Small too|b', 'Small|a']); // the rest synced
    expect(a.notes.map((n) => n.id)).toContain('huge'); // …and the big one is still on its own device
    expect(Object.keys(a.state.localOnlyNotes)).toEqual(['huge']);
    expect(pendingCount(a.state)).toBe(0); // so the badge doesn't claim there is something waiting forever
    a.edit('small1', 'a2');
    await settle(a, b);
    expect(bodies(b)).toContain('Small|a2'); // and syncing keeps working afterwards
  });
});
