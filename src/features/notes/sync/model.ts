/**
 * The pure half of notes sync — no network, no stores — so every rule is unit-tested.
 *
 * Local-first: the notes store is the source the UI reads. We keep a small bookkeeping record (`SyncState`) next to it:
 *   dirty*      ids changed locally and not yet uploaded, with the time of the change
 *   gone*       ids deleted locally and not yet reported, with the time of the deletion
 *   rev*        the last `modified_at` we saw from the server for an id — the *base* of any local edit
 *   localOnly*  ids the server can't take (over its size limits, …): kept on this device, shown as a warning, and
 *               never allowed to block the rest of the sync
 *
 * Conflicts. A local edit and a server change *conflict* when the server holds a version newer than our base (`rev`)
 * while we still have unsynced edits (or an unsynced deletion). The old rule was last-write-wins, which silently threw
 * the loser away. Now nothing is dropped:
 *   • edit / edit      — the later version stays as the note; the other becomes "Title (conflict copy, <date>)" in the
 *                        same notebook (ties go to the server's version). Identical content is not a conflict.
 *   • edit / delete    — the edit is kept: a note edited here but deleted elsewhere is resurrected (and re-uploaded
 *                        with a fresh stamp); a note deleted here but edited elsewhere comes back with that edit.
 *   • offline → online — the same rules, applied per note when the backlog is merged.
 * Where we don't know our base (bookkeeping was reset) an unsynced deletion falls back to the old timestamp rule.
 * Timestamps are client clocks; the *decision* of who conflicts never depends on them, only who wins the note's name.
 */
import type { Note, Notebook } from '@/features/notes/types';
import { ME_ID } from '@/store/useUserStore';

/** localStorage key for the bookkeeping record (kept here so non-sync code can clear it without importing the engine). */
export const SYNC_STATE_KEY = 'pact-sync-notes';

/** What the server's table constraints allow (supabase/migrations/20261116000000_profiles_and_notes.sql). */
export const LIMITS = { id: 64, title: 500, body: 500_000, notebookName: 120 } as const;

export const RECOVERED_NOTEBOOK_ID = 'nb-recovered';

export type Stamps = Record<string, string>;

export type LocalOnlyReason = 'too-large' | 'rejected' | 'notebook';
export type LocalOnly = {
  reason: LocalOnlyReason;
  /** Shown to the person (SyncBadge tooltip). */
  message: string;
  /** When it was last edited here — so a later server change is detected as a conflict, not overwritten. */
  at: string;
  /** For `reason: 'notebook'` — the notebook that can't sync. */
  notebookId?: string;
};

export type SyncState = {
  /** Account the bookkeeping belongs to. */
  owner: string | null;
  dirtyNotebooks: Stamps;
  dirtyNotes: Stamps;
  goneNotebooks: Stamps;
  goneNotes: Stamps;
  revNotebooks: Stamps;
  revNotes: Stamps;
  localOnlyNotebooks: Record<string, LocalOnly>;
  localOnlyNotes: Record<string, LocalOnly>;
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
  localOnlyNotebooks: {},
  localOnlyNotes: {},
  cursor: null,
});

const cloneState = (s: SyncState): SyncState => ({
  ...s,
  dirtyNotebooks: { ...s.dirtyNotebooks },
  dirtyNotes: { ...s.dirtyNotes },
  goneNotebooks: { ...s.goneNotebooks },
  goneNotes: { ...s.goneNotes },
  revNotebooks: { ...s.revNotebooks },
  revNotes: { ...s.revNotes },
  localOnlyNotebooks: { ...s.localOnlyNotebooks },
  localOnlyNotes: { ...s.localOnlyNotes },
});

const stampsOf = (v: unknown): Stamps => {
  const out: Stamps = {};
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x;
  return out;
};

const localOnlyOf = (v: unknown): Record<string, LocalOnly> => {
  const out: Record<string, LocalOnly> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, x] of Object.entries(v)) {
    const o = x as Partial<LocalOnly> | null;
    if (!o || typeof o !== 'object' || typeof o.message !== 'string' || typeof o.at !== 'string') continue;
    const reason: LocalOnlyReason = o.reason === 'too-large' || o.reason === 'notebook' ? o.reason : 'rejected';
    out[k] = { reason, message: o.message, at: o.at, ...(typeof o.notebookId === 'string' ? { notebookId: o.notebookId } : null) };
  }
  return out;
};

/** Persisted bookkeeping is read back from localStorage — never trust its shape (older builds lack newer fields). */
export function normalizeSyncState(raw: unknown): SyncState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    owner: typeof r.owner === 'string' ? r.owner : null,
    dirtyNotebooks: stampsOf(r.dirtyNotebooks),
    dirtyNotes: stampsOf(r.dirtyNotes),
    goneNotebooks: stampsOf(r.goneNotebooks),
    goneNotes: stampsOf(r.goneNotes),
    revNotebooks: stampsOf(r.revNotebooks),
    revNotes: stampsOf(r.revNotes),
    localOnlyNotebooks: localOnlyOf(r.localOnlyNotebooks),
    localOnlyNotes: localOnlyOf(r.localOnlyNotes),
    cursor: typeof r.cursor === 'string' ? r.cursor : null,
  };
}

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

/** Postgres `text` can't hold NUL; the rest of a note is sent as written. */
const noNul = (s: string) => (s.includes('\u0000') ? s.replaceAll('\u0000', '') : s);

export const notebookToRow = (nb: Notebook, modifiedAt: string): NotebookRow & { owner_id?: string } => ({
  id: nb.id,
  name: noNul(nb.name),
  next_number: Math.max(1, nb.nextNumber),
  created_at: nb.createdAt,
  modified_at: modifiedAt,
  deleted_at: null,
});

export const noteToRow = (n: Note, modifiedAt: string): NoteRow => ({
  id: n.id,
  notebook_id: n.notebookId,
  number: n.number,
  title: noNul(n.title),
  body: noNul(n.body),
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

// ── size limits ──────────────────────────────────────────────────────────────

const countCodePoints = (s: string): number => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

/** Postgres `char_length` counts code points, JS `.length` counts UTF-16 units (≥ code points), so only recount when it matters. */
const exceeds = (s: string, max: number) => s.length > max && countCodePoints(s) > max;

export type Problem = { reason: LocalOnlyReason; message: string };

/** Why the server would refuse this note (null = fine). */
export function checkNote(n: Pick<Note, 'id' | 'title' | 'body'>): Problem | null {
  if (n.id.length < 1 || n.id.length > LIMITS.id) return { reason: 'rejected', message: 'Its id isn’t valid for the server.' };
  if (exceeds(n.title, LIMITS.title)) return { reason: 'too-large', message: `The title is longer than ${LIMITS.title} characters.` };
  if (exceeds(n.body, LIMITS.body)) {
    return {
      reason: 'too-large',
      message: `It’s too large to sync (${countCodePoints(n.body).toLocaleString('en-US')} of ${LIMITS.body.toLocaleString('en-US')} characters).`,
    };
  }
  return null;
}

export function checkNotebook(nb: Pick<Notebook, 'id' | 'name'>): Problem | null {
  if (nb.id.length < 1 || nb.id.length > LIMITS.id) return { reason: 'rejected', message: 'Its id isn’t valid for the server.' };
  if (exceeds(nb.name, LIMITS.notebookName)) return { reason: 'too-large', message: `The name is longer than ${LIMITS.notebookName} characters.` };
  return null;
}

export const localOnlyCount = (s: SyncState) => Object.keys(s.localOnlyNotes).length + Object.keys(s.localOnlyNotebooks).length;

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
  const out = cloneState(state);

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
      delete out.localOnlyNotebooks[id];
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
      delete out.localOnlyNotes[id];
    }
  }
  return out;
}

export const pendingCount = (s: SyncState) =>
  Object.keys(s.dirtyNotebooks).length + Object.keys(s.dirtyNotes).length + Object.keys(s.goneNotebooks).length + Object.keys(s.goneNotes).length;

// ── building uploads ─────────────────────────────────────────────────────────

export type Local = { notebooks: Notebook[]; notes: Note[] };
export type Remote = { notebooks: NotebookRow[]; notes: NoteRow[] };

export type Quarantined = { kind: 'note' | 'notebook'; id: string; title: string; reason: LocalOnlyReason; message: string };

export type Batch<Row> = {
  /** The new bookkeeping (anything the server can't take has moved to local-only). */
  state: SyncState;
  /** `stamp` is the `modified_at` the row carries — the dirty stamp *as it was when this content was read*. */
  rows: Array<{ id: string; stamp: string; row: Row }>;
  quarantined: Quarantined[];
};

/**
 * Turn dirty notebook ids into upload rows. `local` must be read in the same tick as this call: pairing content read
 * *now* with the stamp read *now* is what keeps an upload from carrying an old version under a new stamp (which
 * would make a newer local edit look "already uploaded").
 */
export function buildNotebookBatch(local: Local, state: SyncState, ids: readonly string[]): Batch<NotebookRow> {
  const st = cloneState(state);
  const rows: Batch<NotebookRow>['rows'] = [];
  const quarantined: Quarantined[] = [];
  for (const id of ids) {
    const stamp = st.dirtyNotebooks[id];
    const nb = local.notebooks.find((b) => b.id === id);
    if (!nb) {
      delete st.dirtyNotebooks[id]; // gone since it was marked
      continue;
    }
    if (stamp === undefined) continue;
    const problem = checkNotebook(nb);
    if (problem) {
      st.localOnlyNotebooks[id] = { ...problem, at: stamp };
      delete st.dirtyNotebooks[id];
      quarantined.push({ kind: 'notebook', id, title: nb.name, ...problem });
      continue;
    }
    if (st.localOnlyNotebooks[id]) {
      delete st.localOnlyNotebooks[id]; // fixed (e.g. renamed shorter) — its notes can try again
      for (const [noteId, info] of Object.entries(st.localOnlyNotes)) {
        if (info.reason === 'notebook' && info.notebookId === id) {
          delete st.localOnlyNotes[noteId];
          st.dirtyNotes[noteId] = info.at;
        }
      }
    }
    rows.push({ id, stamp, row: notebookToRow(nb, stamp) });
  }
  return { state: st, rows, quarantined };
}

export function buildNoteBatch(local: Local, state: SyncState, ids: readonly string[]): Batch<NoteRow> {
  const st = cloneState(state);
  const rows: Batch<NoteRow>['rows'] = [];
  const quarantined: Quarantined[] = [];
  for (const id of ids) {
    const stamp = st.dirtyNotes[id];
    const n = local.notes.find((x) => x.id === id);
    if (!n) {
      delete st.dirtyNotes[id];
      continue;
    }
    if (stamp === undefined) continue;
    const blocked = st.localOnlyNotebooks[n.notebookId];
    const problem: Problem | null =
      checkNote(n) ?? (blocked ? { reason: 'notebook', message: 'Its notebook can’t be synced, so this note stays on this device too.' } : null);
    if (problem) {
      st.localOnlyNotes[id] = { ...problem, at: stamp, ...(problem.reason === 'notebook' ? { notebookId: n.notebookId } : null) };
      delete st.dirtyNotes[id];
      quarantined.push({ kind: 'note', id, title: n.title, ...problem });
      continue;
    }
    delete st.localOnlyNotes[id]; // within limits again
    rows.push({ id, stamp, row: noteToRow(n, stamp) });
  }
  return { state: st, rows, quarantined };
}

/** Record that the server accepted `sent` — their stamp becomes the base, and the dirty mark goes unless the item changed since. */
export function ackUpload(state: SyncState, kind: 'note' | 'notebook', sent: ReadonlyArray<readonly [string, string]>): SyncState {
  const st = cloneState(state);
  const dirty = kind === 'note' ? st.dirtyNotes : st.dirtyNotebooks;
  const rev = kind === 'note' ? st.revNotes : st.revNotebooks;
  for (const [id, stamp] of sent) {
    rev[id] = maxStamp(rev[id] ?? null, stamp);
    if (dirty[id] === stamp) delete dirty[id];
  }
  return st;
}

/** Record that deletions were reported (`goneAt` is what we held per id, `stamp` what the server was given). */
export function ackDeleted(state: SyncState, kind: 'note' | 'notebook', sent: ReadonlyArray<readonly [string, string]>, stamp: string): SyncState {
  const st = cloneState(state);
  const gone = kind === 'note' ? st.goneNotes : st.goneNotebooks;
  const rev = kind === 'note' ? st.revNotes : st.revNotebooks;
  for (const [id, goneAt] of sent) {
    rev[id] = maxStamp(rev[id] ?? null, stamp);
    if (gone[id] === goneAt) delete gone[id]; // deleted again (or restored and deleted) since → still owed
  }
  return st;
}

/** Mark rows the server permanently refused as local-only. */
export function quarantineRejected(state: SyncState, kind: 'note' | 'notebook', id: string, message: string): SyncState {
  const st = cloneState(state);
  const dirty = kind === 'note' ? st.dirtyNotes : st.dirtyNotebooks;
  const at = dirty[id];
  if (at === undefined) return st;
  (kind === 'note' ? st.localOnlyNotes : st.localOnlyNotebooks)[id] = { reason: 'rejected', message, at };
  delete dirty[id];
  return st;
}

// ── merging what the server has ──────────────────────────────────────────────

export type Conflict =
  /** Both sides edited the note; the other side's version was kept as `copyId`. */
  | { kind: 'copy'; noteId: string; copyId: string; title: string; copyTitle: string; copyIs: 'local' | 'remote' }
  /** An edit survived a deletion on the other side. */
  | { kind: 'kept-edit'; noteId: string; title: string; why: 'deleted-elsewhere' | 'edited-elsewhere' | 'notebook-deleted-elsewhere' };

export type MergeOptions = {
  /** The rows are *everything* the server has (so local items without a row are inferred to be never-uploaded). */
  full: boolean;
  now: string;
  /** Stamps this device sent (see `ownKey`) — a Realtime echo of our own write is not somebody else's change. */
  ownWrites?: ReadonlySet<string>;
  /** Text for "(conflict copy, <this>)". Defaults to the UTC date. */
  label?: (iso: string) => string;
};

export type MergeResult = { local: Local; state: SyncState; changed: boolean; conflicts: Conflict[] };

export const ownKey = (kind: 'note' | 'notebook', id: string, stamp: string) => `${kind}:${id}@${stamp}`;

const newer = (a: string, b: string) => Date.parse(a) > Date.parse(b);
const maxStamp = (a: string | null, b: string): string => (a === null || newer(b, a) ? b : a);

const sameContent = (a: Note, b: Note) => a.title === b.title && a.body === b.body && a.pinned === b.pinned && a.notebookId === b.notebookId;
const sameText = (a: Note, b: Note) => a.title === b.title && a.body === b.body;

/** Clip by code points so a surrogate pair is never cut in half. */
const clip = (s: string, max: number) => (s.length <= max ? s : Array.from(s).slice(0, Math.max(0, max)).join(''));

export function conflictTitle(title: string, label: string): string {
  const suffix = ` (conflict copy, ${label})`;
  return `${clip(title.trim() || 'Untitled', LIMITS.title - suffix.length)}${suffix}`;
}

/** Deterministic, so merging the same conflict twice can't create two copies. Always ≤ 64 chars. */
export const conflictCopyId = (noteId: string, stamp: string) => `${noteId.slice(0, 40)}~c${Math.max(0, Date.parse(stamp) || 0).toString(36)}`;

/**
 * Fold server rows into the local copy.
 *
 * `full` = the rows are *everything* the server has, so a local item with no server row has never been uploaded and
 * is marked dirty (this is what uploads existing local notes the first time someone signs in). For a partial update
 * (realtime / incremental) that inference is not allowed.
 */
export function mergeRemote(local: Local, state: SyncState, remote: Remote, opts: MergeOptions): MergeResult {
  const st = cloneState(state);
  const notebooks = [...local.notebooks];
  let notes = [...local.notes];
  let changed = false;
  const conflicts: Conflict[] = [];
  const label = opts.label ?? ((iso: string) => iso.slice(0, 10));

  const hasNotebook = (id: string) => notebooks.some((b) => b.id === id);

  /** A place for a note whose notebook no longer exists here — so an edit is never dropped just because its folder is gone. */
  const ensureRecovered = (): string => {
    if (!hasNotebook(RECOVERED_NOTEBOOK_ID)) {
      notebooks.push({ id: RECOVERED_NOTEBOOK_ID, name: 'Recovered notes', memberIds: [ME_ID], nextNumber: 1, createdAt: opts.now });
      st.dirtyNotebooks[RECOVERED_NOTEBOOK_ID] = opts.now;
      delete st.goneNotebooks[RECOVERED_NOTEBOOK_ID];
    }
    return RECOVERED_NOTEBOOK_ID;
  };

  /** The notebook a note should live in: the first of these that exists here. */
  const notebookFor = (...preferred: string[]): string => preferred.find(hasNotebook) ?? notebooks[0]?.id ?? ensureRecovered();

  /** Hand out the next `#number` of a notebook (and mark the notebook changed so the counter syncs). */
  const takeNumber = (notebookId: string): number => {
    const i = notebooks.findIndex((b) => b.id === notebookId);
    const nb = notebooks[i];
    if (!nb) return 0;
    notebooks[i] = { ...nb, nextNumber: nb.nextNumber + 1 };
    st.dirtyNotebooks[nb.id] = opts.now;
    return nb.nextNumber;
  };

  // — notebooks —
  for (const r of remote.notebooks) {
    st.cursor = maxStamp(st.cursor, r.modified_at);
    const seen = st.revNotebooks[r.id];
    const gone = st.goneNotebooks[r.id];
    const dirty = st.dirtyNotebooks[r.id] ?? st.localOnlyNotebooks[r.id]?.at;
    const idx = notebooks.findIndex((b) => b.id === r.id);

    if (opts.ownWrites?.has(ownKey('notebook', r.id, r.modified_at))) {
      st.revNotebooks[r.id] = maxStamp(seen ?? null, r.modified_at);
      continue;
    }
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
      // Notes in here that still carry unsynced edits must survive their notebook's deletion elsewhere.
      const keep = notes.filter((n) => n.notebookId === r.id && (st.dirtyNotes[n.id] !== undefined || st.localOnlyNotes[n.id] !== undefined));
      const editedAfter = dirty !== undefined && newer(dirty, r.modified_at);
      if (idx >= 0 && (editedAfter || keep.length > 0)) {
        // we edited after it was deleted (or still hold unsynced notes in it): keep it and let it re-upload
        if (!editedAfter) st.dirtyNotebooks[r.id] = opts.now;
        for (const n of keep) conflicts.push({ kind: 'kept-edit', noteId: n.id, title: n.title, why: 'notebook-deleted-elsewhere' });
        notes = notes.filter((n) => n.notebookId !== r.id || keep.includes(n));
        st.revNotebooks[r.id] = r.modified_at;
        changed = changed || keep.length > 0;
        continue;
      }
      if (dirty && editedAfter) continue;
      if (idx >= 0) {
        notebooks.splice(idx, 1);
        notes = notes.filter((n) => n.notebookId !== r.id);
        changed = true;
      }
      delete st.dirtyNotebooks[r.id];
      delete st.localOnlyNotebooks[r.id];
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
        delete st.localOnlyNotebooks[r.id];
      }
    }
    st.revNotebooks[r.id] = r.modified_at;
  }

  // — notes —
  for (const r of remote.notes) {
    st.cursor = maxStamp(st.cursor, r.modified_at);
    const id = r.id;
    const seen = st.revNotes[id];
    const gone = st.goneNotes[id];
    const localEdit = st.dirtyNotes[id] ?? st.localOnlyNotes[id]?.at; // when we last edited it here, if that hasn't been uploaded
    const idx = notes.findIndex((n) => n.id === id);
    const cur = idx >= 0 ? (notes[idx] as Note) : undefined;
    const see = () => {
      st.revNotes[id] = maxStamp(st.revNotes[id] ?? null, r.modified_at);
    };

    // Our own upload coming back (Realtime can beat the HTTP response): not somebody else's change.
    if (opts.ownWrites?.has(ownKey('note', id, r.modified_at))) {
      see();
      continue;
    }

    // The server holds a version we haven't seen — i.e. it changed since our base. (No base at all counts as "unseen".)
    const unseen = seen === undefined || newer(r.modified_at, seen);
    if (!unseen) {
      // An echo or an older copy. The one exception: a version we saw but no longer hold (cleared storage) comes back.
      const wiped = !r.deleted_at && !cur && !gone && localEdit === undefined;
      if (!wiped) {
        see();
        continue;
      }
    }

    // ── the server says it's deleted ──
    if (r.deleted_at) {
      if (gone) {
        see();
        delete st.goneNotes[id]; // both deleted — nothing left to report
        continue;
      }
      if (cur && localEdit !== undefined) {
        // Edited here, deleted elsewhere: keep the edit. A fresh stamp makes the re-upload supersede the tombstone everywhere.
        st.dirtyNotes[id] = opts.now;
        see();
        conflicts.push({ kind: 'kept-edit', noteId: id, title: cur.title, why: 'deleted-elsewhere' });
        continue;
      }
      if (cur) {
        notes.splice(idx, 1);
        changed = true;
      }
      delete st.dirtyNotes[id];
      delete st.localOnlyNotes[id];
      see();
      continue;
    }

    // ── the server has a live version ──
    let rescued = false;
    if (gone) {
      // We deleted it here; the server has it (not deleted).
      // Known base ⇒ the server's version contains an edit we never saw → keep it. Unknown base ⇒ the old timestamp rule.
      if (seen === undefined && !newer(r.modified_at, gone)) {
        see();
        continue; // an older copy of what we deleted — our deletion stands
      }
      delete st.goneNotes[id];
      rescued = true;
    }

    let nbId = r.notebook_id;
    if (!hasNotebook(nbId)) {
      if (!rescued && !(cur && localEdit !== undefined)) continue; // its notebook is gone; don't resurrect an orphan
      nbId = cur && hasNotebook(cur.notebookId) ? cur.notebookId : ensureRecovered();
    }

    /** Take the server's version as the note. */
    const take = (notebookId: string) => {
      const next = noteFromRow({ ...r, notebook_id: notebookId }, cur);
      if (!cur) {
        notes.push(next);
        changed = true;
      } else if (
        cur.title !== next.title ||
        cur.body !== next.body ||
        cur.pinned !== next.pinned ||
        cur.notebookId !== next.notebookId ||
        cur.updatedAt !== next.updatedAt
      ) {
        notes[idx] = next;
        changed = true;
      }
      delete st.dirtyNotes[id];
      delete st.localOnlyNotes[id];
      if (rescued && notebookId === RECOVERED_NOTEBOOK_ID) {
        st.dirtyNotes[id] = opts.now; // it moved into the recovery notebook — report that
        st.revNotes[id] = maxStamp(st.revNotes[id] ?? null, r.modified_at);
      } else see();
    };

    /** Keep `src` as a new note next to the original. */
    const keepAsCopy = (src: Pick<Note, 'title' | 'body' | 'assigneeId'>, loserStamp: string, notebookId: string, copyIs: 'local' | 'remote') => {
      const copyId = conflictCopyId(id, loserStamp);
      if (notes.some((n) => n.id === copyId)) return;
      const title = conflictTitle(src.title, label(opts.now));
      notes.push({
        id: copyId,
        notebookId,
        number: takeNumber(notebookId),
        title,
        body: src.body,
        pinned: false,
        assigneeId: src.assigneeId,
        createdAt: opts.now,
        updatedAt: opts.now, // surfaces at the top of the list, where it will be noticed
      });
      st.dirtyNotes[copyId] = opts.now;
      changed = true;
      conflicts.push({ kind: 'copy', noteId: id, copyId, title: src.title, copyTitle: title, copyIs });
    };

    if (cur && localEdit !== undefined) {
      // Both sides changed since the base.
      const theirs = noteFromRow({ ...r, notebook_id: nbId }, cur);
      if (sameContent(cur, theirs)) {
        take(nbId); // the same edit on both sides — nothing to keep apart
      } else if (sameText(cur, theirs)) {
        // only the pin / notebook differ: the later change wins, there's no text to preserve
        if (newer(localEdit, r.modified_at)) see();
        else take(nbId);
      } else if (newer(localEdit, r.modified_at)) {
        // Ours is later: it stays the note (and re-uploads over the server's copy); the server's version is kept beside it.
        see();
        keepAsCopy(theirs, r.modified_at, notebookFor(nbId, cur.notebookId), 'remote');
      } else {
        // The server's is later (or it's a tie): it stays the note; ours is kept beside it.
        keepAsCopy(cur, localEdit, notebookFor(cur.notebookId, nbId), 'local');
        take(nbId);
      }
    } else {
      take(nbId);
      if (rescued) conflicts.push({ kind: 'kept-edit', noteId: id, title: r.title, why: 'edited-elsewhere' });
    }
  }

  // — a full pull: anything local the server has never heard of must be uploaded —
  if (opts.full) {
    const remoteNb = new Set(remote.notebooks.map((r) => r.id));
    const remoteN = new Set(remote.notes.map((r) => r.id));
    for (const b of notebooks)
      if (!remoteNb.has(b.id) && !st.dirtyNotebooks[b.id] && !st.goneNotebooks[b.id] && !st.localOnlyNotebooks[b.id]) st.dirtyNotebooks[b.id] = opts.now;
    for (const n of notes) if (!remoteN.has(n.id) && !st.dirtyNotes[n.id] && !st.goneNotes[n.id] && !st.localOnlyNotes[n.id]) st.dirtyNotes[n.id] = opts.now;
  }

  return { local: { notebooks, notes }, state: st, changed, conflicts };
}
