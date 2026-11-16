/**
 * The pure half of notes sync — no network, no stores — so every rule is unit-tested.
 *
 * Local-first: the notes store is the source the UI reads. We keep a small bookkeeping record (`SyncState`) next to it:
 *   dirty*  ids changed locally and not yet uploaded, with the time of the change
 *   gone*   ids deleted locally and not yet reported, with the time of the deletion
 *   rev*    the last `modified_at` we saw from the server for an id (so older echoes are ignored)
 * Conflicts are last-write-wins on `modified_at` (client clocks; fine for one person's own devices).
 */
import type { Note, Notebook } from '@/features/notes/types';
import { ME_ID } from '@/store/useUserStore';

/** localStorage key for the bookkeeping record (kept here so non-sync code can clear it without importing the engine). */
export const SYNC_STATE_KEY = 'pact-sync-notes';

export type Stamps = Record<string, string>;

export type SyncState = {
  /** Account the bookkeeping belongs to. */
  owner: string | null;
  dirtyNotebooks: Stamps;
  dirtyNotes: Stamps;
  goneNotebooks: Stamps;
  goneNotes: Stamps;
  revNotebooks: Stamps;
  revNotes: Stamps;
  /** Newest `modified_at` seen — the cursor for incremental pulls. */
  cursor: string | null;
};

export const emptySyncState = (owner: string | null = null): SyncState => ({
  owner,
  dirtyNotebooks: {},
  dirtyNotes: {},
  goneNotebooks: {},
  goneNotes: {},
  revNotebooks: {},
  revNotes: {},
  cursor: null,
});

export type NotebookRow = { id: string; name: string; next_number: number; created_at: string; modified_at: string; deleted_at: string | null };
export type NoteRow = {
  id: string;
  notebook_id: string;
  number: number;
  title: string;
  body: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  modified_at: string;
  deleted_at: string | null;
};

// ── rows ↔ local ─────────────────────────────────────────────────────────────

export const notebookToRow = (nb: Notebook, modifiedAt: string): NotebookRow & { owner_id?: string } => ({
  id: nb.id,
  name: nb.name,
  next_number: Math.max(1, nb.nextNumber),
  created_at: nb.createdAt,
  modified_at: modifiedAt,
  deleted_at: null,
});

export const noteToRow = (n: Note, modifiedAt: string): NoteRow => ({
  id: n.id,
  notebook_id: n.notebookId,
  number: n.number,
  title: n.title,
  body: n.body,
  pinned: n.pinned,
  created_at: n.createdAt,
  updated_at: n.updatedAt,
  modified_at: modifiedAt,
  deleted_at: null,
});

export const notebookFromRow = (r: NotebookRow): Notebook => ({
  id: r.id,
  name: r.name,
  memberIds: [ME_ID],
  nextNumber: r.next_number,
  createdAt: r.created_at,
});

export const noteFromRow = (r: NoteRow, keep?: Pick<Note, 'assigneeId'>): Note => ({
  id: r.id,
  notebookId: r.notebook_id,
  number: r.number,
  title: r.title,
  body: r.body,
  pinned: r.pinned,
  assigneeId: keep?.assigneeId ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// ── tracking local changes ───────────────────────────────────────────────────

const sameNotebook = (a: Notebook, b: Notebook) => a === b || (a.name === b.name && a.nextNumber === b.nextNumber);

/**
 * Compare the notes store before and after a change. Anything added/edited is marked dirty, anything removed is
 * marked gone (and a note that is back — e.g. an undone delete — stops being gone).
 */
export function trackChanges(
  state: SyncState,
  prev: { notebooks: Notebook[]; notes: Note[] },
  next: { notebooks: Notebook[]; notes: Note[] },
  now: string,
): SyncState {
  const out: SyncState = {
    ...state,
    dirtyNotebooks: { ...state.dirtyNotebooks },
    dirtyNotes: { ...state.dirtyNotes },
    goneNotebooks: { ...state.goneNotebooks },
    goneNotes: { ...state.goneNotes },
  };

  const prevNb = new Map(prev.notebooks.map((b) => [b.id, b]));
  const nextNb = new Map(next.notebooks.map((b) => [b.id, b]));
  for (const [id, b] of nextNb) {
    const was = prevNb.get(id);
    if (!was || !sameNotebook(was, b)) {
      out.dirtyNotebooks[id] = now;
      delete out.goneNotebooks[id];
    }
  }
  for (const id of prevNb.keys()) {
    if (!nextNb.has(id)) {
      out.goneNotebooks[id] = now;
      delete out.dirtyNotebooks[id];
    }
  }

  const prevN = new Map(prev.notes.map((n) => [n.id, n]));
  const nextN = new Map(next.notes.map((n) => [n.id, n]));
  for (const [id, n] of nextN) {
    const was = prevN.get(id);
    // `assigneeId` is local-only (people aren't synced yet), so changing it alone isn't a change worth uploading.
    if (
      !was ||
      (was !== n && !(was.title === n.title && was.body === n.body && was.pinned === n.pinned && was.notebookId === n.notebookId && was.number === n.number))
    ) {
      out.dirtyNotes[id] = now;
      delete out.goneNotes[id];
    }
  }
  for (const id of prevN.keys()) {
    if (!nextN.has(id)) {
      out.goneNotes[id] = now;
      delete out.dirtyNotes[id];
    }
  }
  return out;
}

export const pendingCount = (s: SyncState) =>
  Object.keys(s.dirtyNotebooks).length + Object.keys(s.dirtyNotes).length + Object.keys(s.goneNotebooks).length + Object.keys(s.goneNotes).length;

// ── merging what the server has ──────────────────────────────────────────────

export type Remote = { notebooks: NotebookRow[]; notes: NoteRow[] };
export type Local = { notebooks: Notebook[]; notes: Note[] };

const newer = (a: string, b: string) => Date.parse(a) > Date.parse(b);
const maxStamp = (a: string | null, b: string) => (a === null || newer(b, a) ? b : a);

/**
 * Fold server rows into the local copy.
 *
 * `full` = the rows are *everything* the server has, so a local item with no server row has never been uploaded and
 * is marked dirty (this is what uploads existing local notes the first time someone signs in). For a partial update
 * (realtime / incremental) that inference is not allowed.
 */
export function mergeRemote(
  local: Local,
  state: SyncState,
  remote: Remote,
  opts: { full: boolean; now: string },
): { local: Local; state: SyncState; changed: boolean } {
  const st: SyncState = {
    ...state,
    dirtyNotebooks: { ...state.dirtyNotebooks },
    dirtyNotes: { ...state.dirtyNotes },
    goneNotebooks: { ...state.goneNotebooks },
    goneNotes: { ...state.goneNotes },
    revNotebooks: { ...state.revNotebooks },
    revNotes: { ...state.revNotes },
  };
  const notebooks = [...local.notebooks];
  let notes = [...local.notes];
  let changed = false;

  // — notebooks —
  for (const r of remote.notebooks) {
    st.cursor = maxStamp(st.cursor, r.modified_at);
    const seen = st.revNotebooks[r.id];
    const gone = st.goneNotebooks[r.id];
    const dirty = st.dirtyNotebooks[r.id];
    const idx = notebooks.findIndex((b) => b.id === r.id);

    // Already have this version — but only if we still hold the item (a wiped local copy must be restorable).
    if (seen && idx >= 0 && !newer(r.modified_at, seen) && !gone && !dirty) continue;

    if (gone) {
      if (r.deleted_at || !newer(r.modified_at, gone)) {
        st.revNotebooks[r.id] = r.modified_at;
        continue; // our deletion wins (and is/will be reported)
      }
      delete st.goneNotebooks[r.id]; // edited elsewhere after we deleted it — bring it back
    }
    if (r.deleted_at) {
      if (dirty && newer(dirty, r.modified_at)) continue; // we edited after it was deleted: keep ours, it re-uploads
      if (idx >= 0) {
        notebooks.splice(idx, 1);
        notes = notes.filter((n) => n.notebookId !== r.id);
        changed = true;
      }
      delete st.dirtyNotebooks[r.id];
      st.revNotebooks[r.id] = r.modified_at;
      continue;
    }
    if (idx < 0) {
      notebooks.push(notebookFromRow(r));
      changed = true;
    } else {
      const cur = notebooks[idx] as Notebook;
      if (dirty && !newer(r.modified_at, dirty)) {
        notebooks[idx] = { ...cur, nextNumber: Math.max(cur.nextNumber, r.next_number) }; // ours is newer; keep the counter safe
      } else {
        const merged = { ...cur, name: r.name, nextNumber: Math.max(cur.nextNumber, r.next_number) };
        if (!sameNotebook(cur, merged)) changed = true;
        notebooks[idx] = merged;
        delete st.dirtyNotebooks[r.id];
      }
    }
    st.revNotebooks[r.id] = r.modified_at;
  }

  // — notes —
  for (const r of remote.notes) {
    st.cursor = maxStamp(st.cursor, r.modified_at);
    const seen = st.revNotes[r.id];
    const gone = st.goneNotes[r.id];
    const dirty = st.dirtyNotes[r.id];
    const idx = notes.findIndex((n) => n.id === r.id);

    if (seen && idx >= 0 && !newer(r.modified_at, seen) && !gone && !dirty) continue;

    if (gone) {
      if (r.deleted_at || !newer(r.modified_at, gone)) {
        st.revNotes[r.id] = r.modified_at;
        continue;
      }
      delete st.goneNotes[r.id];
    }
    if (r.deleted_at) {
      if (dirty && newer(dirty, r.modified_at)) continue;
      if (idx >= 0) {
        notes.splice(idx, 1);
        changed = true;
      }
      delete st.dirtyNotes[r.id];
      st.revNotes[r.id] = r.modified_at;
      continue;
    }
    if (dirty && !newer(r.modified_at, dirty)) continue; // our unsent edit is newer — it will overwrite the server copy
    if (!notebooks.some((b) => b.id === r.notebook_id)) continue; // its notebook is gone; don't resurrect an orphan
    const next = noteFromRow(r, idx >= 0 ? (notes[idx] as Note) : undefined);
    if (idx < 0) {
      notes.push(next);
      changed = true;
    } else {
      const cur = notes[idx] as Note;
      if (
        cur.title !== next.title ||
        cur.body !== next.body ||
        cur.pinned !== next.pinned ||
        cur.notebookId !== next.notebookId ||
        cur.updatedAt !== next.updatedAt
      ) {
        notes[idx] = next;
        changed = true;
      }
    }
    delete st.dirtyNotes[r.id];
    st.revNotes[r.id] = r.modified_at;
  }

  // — a full pull: anything local the server has never heard of must be uploaded —
  if (opts.full) {
    const remoteNb = new Set(remote.notebooks.map((r) => r.id));
    const remoteN = new Set(remote.notes.map((r) => r.id));
    for (const b of notebooks) if (!remoteNb.has(b.id) && !st.dirtyNotebooks[b.id] && !st.goneNotebooks[b.id]) st.dirtyNotebooks[b.id] = opts.now;
    for (const n of notes) if (!remoteN.has(n.id) && !st.dirtyNotes[n.id] && !st.goneNotes[n.id]) st.dirtyNotes[n.id] = opts.now;
  }

  return { local: { notebooks, notes }, state: st, changed };
}
