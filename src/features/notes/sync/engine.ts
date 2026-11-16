/**
 * Notes ⇄ Supabase, local-first.
 *
 * The notes store stays the source the UI reads, so everything is instant and works offline. This engine watches it,
 * uploads changes in the background (debounced, with retry/backoff), pulls the server's copy on sign-in/focus and
 * applies other devices' changes live through Realtime. The rules live in `model.ts`; this file is the I/O around it.
 *
 * Only ONE tab runs the engine (a Web Lock), otherwise several new-tab pages would upload the same edits at once.
 * Edits made in other tabs reach the leader through the store's cross-tab rehydrate, so nothing is missed.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { create } from 'zustand';
import { useNotesStore } from '@/features/notes/store';
import {
  emptySyncState,
  mergeRemote,
  type NotebookRow,
  type NoteRow,
  notebookToRow,
  noteToRow,
  pendingCount,
  SYNC_STATE_KEY,
  type SyncState,
  trackChanges,
} from '@/features/notes/sync/model';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/store/useAuthStore';

const CHUNK = 100;
const PAGE = 1000;
const NOTEBOOK_COLS = 'id, name, next_number, created_at, modified_at, deleted_at';
const NOTE_COLS = 'id, notebook_id, number, title, body, pinned, created_at, updated_at, modified_at, deleted_at';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
export const useNotesSync = create<{ status: SyncStatus; pending: number; lastSyncedAt: number | null }>(() => ({
  status: 'idle',
  pending: 0,
  lastSyncedAt: null,
}));

// ── persisted bookkeeping ────────────────────────────────────────────────────

export function readSyncState(): SyncState | null {
  try {
    const raw = localStorage.getItem(SYNC_STATE_KEY);
    return raw ? (JSON.parse(raw) as SyncState) : null;
  } catch {
    return null;
  }
}

/** Unsynced changes recorded on this device (readable from any tab). */
export const pendingNotesChanges = (): number => {
  const s = readSyncState();
  return s ? pendingCount(s) : 0;
};

const nowIso = () => new Date().toISOString();
const chunks = <T>(xs: T[], n = CHUNK): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// ── engine state (leader tab only) ───────────────────────────────────────────

let state: SyncState = emptySyncState();
let userId: string | null = null;
let applying = false;
let flushing: Promise<void> | null = null;
let flushTimer: number | undefined;
let retryTimer: number | undefined;
let retryMs = 5000;
let channel: RealtimeChannel | null = null;
let lastPull = 0;
let leader = false;

function persist() {
  try {
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
  } catch {
    /* storage full — bookkeeping is rebuilt from a full pull next time */
  }
  useNotesSync.setState({ pending: pendingCount(state) });
}

function setStatus(status: SyncStatus) {
  useNotesSync.setState({ status, ...(status === 'synced' ? { lastSyncedAt: Date.now() } : null) });
}

const localNow = () => {
  const { notebooks, notes } = useNotesStore.getState();
  return { notebooks, notes };
};

function applyLocal(next: { notebooks: ReturnType<typeof localNow>['notebooks']; notes: ReturnType<typeof localNow>['notes'] }) {
  applying = true;
  try {
    useNotesStore.setState((s) => ({
      notebooks: next.notebooks,
      notes: next.notes,
      activeNotebookId: next.notebooks.some((b) => b.id === s.activeNotebookId) ? s.activeNotebookId : (next.notebooks[0]?.id ?? s.activeNotebookId),
      selectedId: s.selectedId && next.notes.some((n) => n.id === s.selectedId) ? s.selectedId : null,
    }));
  } finally {
    applying = false;
  }
}

function onOffline(err: unknown) {
  console.warn('[pact] notes sync:', err);
  setStatus(navigator.onLine ? 'error' : 'offline');
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => void run(), retryMs);
  retryMs = Math.min(retryMs * 2, 60_000);
}

// ── upload ───────────────────────────────────────────────────────────────────

async function upload(): Promise<void> {
  if (!supabase || !userId) return;
  const owner = userId;
  const { notebooks, notes } = localNow();

  // 1. notebooks first (notes reference them)
  const nbIds = Object.keys(state.dirtyNotebooks).filter((id) => notebooks.some((b) => b.id === id));
  for (const ids of chunks(nbIds)) {
    const sent = ids.map((id) => [id, state.dirtyNotebooks[id] as string] as const);
    const rows = sent.map(([id, ts]) => ({ owner_id: owner, ...notebookToRow(notebooks.find((b) => b.id === id) as (typeof notebooks)[number], ts) }));
    const { error } = await supabase.from('notebooks').upsert(rows, { onConflict: 'owner_id,id' });
    if (error) throw error;
    for (const [id, ts] of sent) {
      state.revNotebooks[id] = ts;
      if (state.dirtyNotebooks[id] === ts) delete state.dirtyNotebooks[id];
    }
    persist();
  }
  for (const id of Object.keys(state.dirtyNotebooks)) if (!notebooks.some((b) => b.id === id)) delete state.dirtyNotebooks[id]; // gone since

  // 2. notes
  const noteIds = Object.keys(state.dirtyNotes).filter((id) => notes.some((n) => n.id === id));
  for (const ids of chunks(noteIds)) {
    const sent = ids.map((id) => [id, state.dirtyNotes[id] as string] as const);
    const rows = sent.map(([id, ts]) => ({ owner_id: owner, ...noteToRow(notes.find((n) => n.id === id) as (typeof notes)[number], ts) }));
    const { error } = await supabase.from('notes').upsert(rows, { onConflict: 'owner_id,id' });
    if (error) throw error;
    for (const [id, ts] of sent) {
      state.revNotes[id] = ts;
      if (state.dirtyNotes[id] === ts) delete state.dirtyNotes[id];
    }
    persist();
  }
  for (const id of Object.keys(state.dirtyNotes)) if (!notes.some((n) => n.id === id)) delete state.dirtyNotes[id];

  // 3. deletions (soft: the row stays, marked deleted, so other devices learn about it)
  for (const table of ['notes', 'notebooks'] as const) {
    const gone = table === 'notes' ? state.goneNotes : state.goneNotebooks;
    for (const ids of chunks(Object.keys(gone))) {
      const stamp = ids.map((id) => gone[id] as string).reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
      const { error } = await supabase.from(table).update({ deleted_at: stamp, modified_at: stamp }).eq('owner_id', owner).in('id', ids);
      if (error) throw error;
      for (const id of ids) {
        (table === 'notes' ? state.revNotes : state.revNotebooks)[id] = stamp;
        delete gone[id];
      }
      persist();
    }
  }
}

function flush(): Promise<void> {
  if (flushing) return flushing;
  if (!supabase || !userId || pendingCount(state) === 0) return Promise.resolve();
  setStatus('syncing');
  flushing = (async () => {
    try {
      await upload();
      retryMs = 5000;
      setStatus('synced');
    } catch (err) {
      onOffline(err);
    } finally {
      flushing = null;
      // edits that arrived while uploading
      if (pendingCount(state) > 0 && useNotesSync.getState().status === 'synced') scheduleFlush(300);
    }
  })();
  return flushing;
}

function scheduleFlush(ms = 800) {
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => void flush(), ms);
}

// ── download ─────────────────────────────────────────────────────────────────

async function fetchAll<T>(table: 'notebooks' | 'notes', cols: string, since: string | null): Promise<T[]> {
  if (!supabase) return [];
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from(table)
      .select(cols)
      .order('modified_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (since) q = q.gt('modified_at', since);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

async function pull(full: boolean): Promise<void> {
  const since = full ? null : state.cursor;
  const [notebooks, notes] = await Promise.all([fetchAll<NotebookRow>('notebooks', NOTEBOOK_COLS, since), fetchAll<NoteRow>('notes', NOTE_COLS, since)]);
  const merged = mergeRemote(localNow(), state, { notebooks, notes }, { full, now: nowIso() });
  state = merged.state;
  if (merged.changed) applyLocal(merged.local);
  persist();
  lastPull = Date.now();
}

function onRealtime(table: 'notebooks' | 'notes', row: unknown) {
  const r = row as Partial<NoteRow & NotebookRow> | null;
  // Rows too big for a Realtime message arrive without their columns; fall back to asking the server.
  if (!r || typeof r.id !== 'string' || typeof r.modified_at !== 'string' || (table === 'notes' && typeof r.body !== 'string')) {
    void run(false);
    return;
  }
  const remote = table === 'notes' ? { notebooks: [], notes: [r as NoteRow] } : { notebooks: [r as NotebookRow], notes: [] };
  const merged = mergeRemote(localNow(), state, remote, { full: false, now: nowIso() });
  state = merged.state;
  if (merged.changed) applyLocal(merged.local);
  persist();
}

/** Pull then push. `full` on sign-in / start; incremental otherwise. */
async function run(full = false): Promise<void> {
  if (!supabase || !userId) return;
  try {
    setStatus('syncing');
    await pull(full || state.cursor === null);
    await flush();
    if (pendingCount(state) === 0) setStatus('synced');
  } catch (err) {
    onOffline(err);
  }
}

function connect(id: string) {
  disconnect();
  userId = id;
  const saved = readSyncState();
  state = saved && saved.owner === id ? saved : emptySyncState(id); // someone else's bookkeeping is meaningless here
  persist();
  void run(true);
  if (!supabase) return;
  channel = supabase
    .channel(`notes:${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notebooks', filter: `owner_id=eq.${id}` }, (p) => onRealtime('notebooks', p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `owner_id=eq.${id}` }, (p) => onRealtime('notes', p.new))
    .subscribe((s) => {
      if (s === 'SUBSCRIBED' && Date.now() - lastPull > 5000) void run(false); // catch up on anything missed while connecting
    });
}

function disconnect() {
  window.clearTimeout(flushTimer);
  window.clearTimeout(retryTimer);
  if (channel && supabase) void supabase.removeChannel(channel);
  channel = null;
  userId = null;
  setStatus('idle');
}

/** Upload everything pending now (used before signing out). Resolves when done or failed. */
export async function flushNotesNow(): Promise<void> {
  window.clearTimeout(flushTimer);
  if (leader) await flush();
}

/** Wait (up to `ms`) for the leader tab to report nothing pending; returns what is still pending. */
export async function drainNotes(ms = 5000): Promise<number> {
  await flushNotesNow();
  const end = Date.now() + ms;
  while (pendingNotesChanges() > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 250));
  return pendingNotesChanges();
}

// ── start ────────────────────────────────────────────────────────────────────

function runEngine() {
  leader = true;
  let current: string | null = null;
  const onUser = (id: string | null) => {
    if (id === current) return;
    current = id;
    if (id) connect(id);
    else disconnect();
  };
  useAuthStore.subscribe((s) => onUser(s.user?.id ?? null));
  onUser(useAuthStore.getState().user?.id ?? null);

  useNotesStore.subscribe((s, prev) => {
    if (applying || !userId) return;
    if (s.notes === prev.notes && s.notebooks === prev.notebooks) return;
    state = trackChanges(state, prev, s, nowIso());
    persist();
    scheduleFlush();
  });

  window.addEventListener('online', () => void run(false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && userId && Date.now() - lastPull > 30_000) void run(false);
  });
}

let started = false;

export function startNotesSync(): void {
  if (started || !supabase) return;
  started = true;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) {
    runEngine();
    return;
  }
  // Becomes leader when it gets the lock — immediately if no other pact tab is open, otherwise when the leader closes.
  void locks.request('pact-notes-sync', () => {
    runEngine();
    return new Promise<void>(() => {});
  });
}
