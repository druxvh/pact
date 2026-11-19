/**
 * Notes ⇄ Supabase, local-first.
 *
 * The notes store stays the source the UI reads, so everything is instant and works offline. This engine watches it,
 * uploads changes in the background (debounced, with retry/backoff), pulls the server's copy on sign-in/focus and
 * applies other devices' changes live through Realtime. The rules live in `model.ts` (what to keep, conflict copies,
 * size limits) and `uploader.ts` (how a batch is sent); this file is the I/O around them.
 *
 * Only ONE tab runs the engine (a Web Lock), otherwise several new-tab pages would upload the same edits at once.
 * Edits made in other tabs reach the leader through the store's cross-tab rehydrate, so nothing is missed.
 *
 * Account safety: before every request and every merge the engine checks that the signed-in account still owns the
 * data on this device (`isAccountCurrent`). If another tab signed in as someone else, the engine stops dead — it never
 * uploads one account's notes into another's.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { create } from 'zustand';
import { useNotesStore } from '@/features/notes/store';
import {
  type Conflict,
  emptySyncState,
  type LocalOnlyReason,
  localOnlyCount,
  mergeRemote,
  type NotebookRow,
  type NoteRow,
  normalizeSyncState,
  pendingCount,
  SYNC_STATE_KEY,
  type SyncState,
  trackChanges,
} from '@/features/notes/sync/model';
import { AccountChanged, classifyError, uploadPending } from '@/features/notes/sync/uploader';
import { persistenceFrozen } from '@/lib/persist';
import { supabase } from '@/lib/supabase/client';
import { isAccountCurrent } from '@/lib/supabase/owner';
import { notify } from '@/lib/toast';
import { useAuthStore } from '@/store/useAuthStore';
import { useNotificationStore } from '@/store/useNotificationStore';

const PAGE = 1000;
const NOTEBOOK_COLS = 'id, name, next_number, created_at, modified_at, deleted_at';
const NOTE_COLS = 'id, notebook_id, number, title, body, pinned, created_at, updated_at, modified_at, deleted_at';

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
/** A note or notebook that stays on this device because the server can't take it. */
export type LocalOnlyItem = { kind: 'note' | 'notebook'; id: string; title: string; message: string; reason: LocalOnlyReason };

export const useNotesSync = create<{ status: SyncStatus; pending: number; lastSyncedAt: number | null; localOnly: LocalOnlyItem[] }>(() => ({
  status: 'idle',
  pending: 0,
  lastSyncedAt: null,
  localOnly: [],
}));

// ── persisted bookkeeping ────────────────────────────────────────────────────

export function readSyncState(): SyncState | null {
  try {
    const raw = localStorage.getItem(SYNC_STATE_KEY);
    return raw ? normalizeSyncState(JSON.parse(raw)) : null;
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
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

function localOnlyItems(s: SyncState): LocalOnlyItem[] {
  const { notes, notebooks } = useNotesStore.getState();
  return [
    ...Object.entries(s.localOnlyNotes).map(([id, o]) => ({
      kind: 'note' as const,
      id,
      title: notes.find((n) => n.id === id)?.title.trim() || 'Untitled',
      message: o.message,
      reason: o.reason,
    })),
    ...Object.entries(s.localOnlyNotebooks).map(([id, o]) => ({
      kind: 'notebook' as const,
      id,
      title: notebooks.find((b) => b.id === id)?.name ?? 'Notebook',
      message: o.message,
      reason: o.reason,
    })),
  ];
}

function publish(s: SyncState) {
  const localOnly = localOnlyCount(s) > 0 ? localOnlyItems(s) : [];
  useNotesSync.setState({ pending: pendingCount(s), localOnly });
}

// ── engine state (leader tab only) ───────────────────────────────────────────

let state: SyncState = emptySyncState();
let userId: string | null = null;
let applying = false;
let halted = false;
let flushing: Promise<void> | null = null;
let flushTimer: number | undefined;
let retryTimer: number | undefined;
let retryMs = 5000;
let channel: RealtimeChannel | null = null;
let lastPull = 0;
let leader = false;
/** What this device has sent (see `ownKey`), so Realtime echoes of our own writes aren't mistaken for another device's edit. */
const ownWrites = new Set<string>();
/** Local-only notes already announced this session (the badge keeps showing them). */
const warned = new Set<string>();

function persist() {
  if (halted || persistenceFrozen()) return;
  try {
    localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
  } catch {
    /* storage full — bookkeeping is rebuilt from a full pull next time */
  }
  publish(state);
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

/** Throws `AccountChanged` unless the signed-in account still owns this device's data. */
function guard() {
  if (halted || !userId || !isAccountCurrent(userId)) throw new AccountChanged();
}

/** Another account took over this device (or sign-in state changed under us): stop, send nothing more. */
function stopForAccountChange() {
  halted = true;
  disconnect();
}

function onOffline(err: unknown) {
  if (err instanceof AccountChanged) {
    stopForAccountChange();
    return;
  }
  console.warn('[pact] notes sync:', err);
  setStatus(navigator.onLine ? 'error' : 'offline');
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => void run(), retryMs);
  retryMs = Math.min(retryMs * 2, 60_000);
}

// ── telling the person ───────────────────────────────────────────────────────

const quote = (t: string) => `“${t.trim() || 'Untitled'}”`;

/** One toast + one notification per merge, so a backlog of conflicts doesn't become a wall of popups. */
function announceConflicts(conflicts: Conflict[]) {
  if (conflicts.length === 0) return;
  let title: string;
  let body: string;
  if (conflicts.length === 1) {
    const c = conflicts[0] as Conflict;
    if (c.kind === 'copy') {
      title = `Kept both versions of ${quote(c.title)}`;
      body = `It was edited in two places. The other version is saved as ${quote(c.copyTitle)}.`;
    } else if (c.why === 'deleted-elsewhere') {
      title = `${quote(c.title)} was kept`;
      body = 'You edited it here but it was deleted on another device, so your edit won and the note is back.';
    } else if (c.why === 'edited-elsewhere') {
      title = `${quote(c.title)} is back`;
      body = 'You deleted it here, but it was edited on another device — that edit was kept.';
    } else {
      title = `${quote(c.title)} was kept`;
      body = 'Its notebook was deleted on another device, but you had unsaved edits here, so the notebook and note stay.';
    }
  } else {
    const copies = conflicts.filter((c) => c.kind === 'copy').length;
    title = `${conflicts.length} notes needed a decision — nothing was lost`;
    body =
      copies > 0
        ? `${copies} ${copies === 1 ? 'was' : 'were'} edited in two places; the other version is saved as “(conflict copy, …)” next to it. The rest were edits that survived a deletion on another device.`
        : 'These were edited on one device and deleted on another. The edits were kept.';
  }
  notify.info(title, body);
  useNotificationStore.getState().add({ title, body, kind: 'system', link: { section: 'notes' } });
}

function announceLocalOnly(items: Array<{ kind: 'note' | 'notebook'; id: string; title: string; message: string }>) {
  for (const it of items) {
    if (warned.has(it.id)) continue;
    warned.add(it.id);
    notify.error(
      `${quote(it.title || (it.kind === 'note' ? 'Untitled' : 'Notebook'))} can’t be synced`,
      `${it.message} It stays on this device only; everything else keeps syncing.`,
    );
  }
}

// ── upload ───────────────────────────────────────────────────────────────────

async function upload(): Promise<void> {
  const client = supabase;
  if (!client || !userId) return;
  const owner = userId;
  await uploadPending({
    owner,
    local: localNow,
    state: () => state,
    setState: (s) => {
      state = s;
      persist();
    },
    guard,
    ownWrites,
    onQuarantine: announceLocalOnly,
    upsert: async (table, rows) => {
      const { error, status } = await client.from(table).upsert(rows, { onConflict: 'owner_id,id' });
      return classifyError(error ? { code: error.code, message: error.message, status } : null);
    },
    softDelete: async (table, ids, stamp) => {
      const { error, status } = await client.from(table).update({ deleted_at: stamp, modified_at: stamp }).eq('owner_id', owner).in('id', ids);
      return classifyError(error ? { code: error.code, message: error.message, status } : null);
    },
  });
  if (ownWrites.size > 5000) ownWrites.clear(); // echoes arrive within seconds; this only bounds memory
}

function flush(): Promise<void> {
  if (flushing) return flushing;
  if (halted || !supabase || !userId || pendingCount(state) === 0) return Promise.resolve();
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
      if (!halted && pendingCount(state) > 0 && useNotesSync.getState().status === 'synced') scheduleFlush(300);
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

/** Merge server rows into the store — synchronously, so nothing can slip in between reading local state and writing it. */
function mergeAndApply(remote: { notebooks: NotebookRow[]; notes: NoteRow[] }, full: boolean) {
  guard();
  const merged = mergeRemote(localNow(), state, remote, { full, now: nowIso(), ownWrites, label: dayLabel });
  state = merged.state;
  if (merged.changed) applyLocal(merged.local);
  persist();
  announceConflicts(merged.conflicts);
  if (pendingCount(state) > 0) scheduleFlush(300); // conflict copies / resurrected edits need uploading
}

async function pull(full: boolean): Promise<void> {
  const since = full ? null : state.cursor;
  const [notebooks, notes] = await Promise.all([fetchAll<NotebookRow>('notebooks', NOTEBOOK_COLS, since), fetchAll<NoteRow>('notes', NOTE_COLS, since)]);
  mergeAndApply({ notebooks, notes }, full);
  lastPull = Date.now();
}

function onRealtime(table: 'notebooks' | 'notes', row: unknown) {
  const r = row as Partial<NoteRow & NotebookRow> | null;
  // Rows too big for a Realtime message arrive without their columns; fall back to asking the server.
  if (!r || typeof r.id !== 'string' || typeof r.modified_at !== 'string' || (table === 'notes' && typeof r.body !== 'string')) {
    void run(false);
    return;
  }
  try {
    mergeAndApply(table === 'notes' ? { notebooks: [], notes: [r as NoteRow] } : { notebooks: [r as NotebookRow], notes: [] }, false);
  } catch (err) {
    onOffline(err);
  }
}

/** Pull then push. `full` on sign-in / start; incremental otherwise. */
async function run(full = false): Promise<void> {
  if (halted || !supabase || !userId) return;
  try {
    guard();
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
  if (halted || !isAccountCurrent(id)) return; // not (or no longer) the account that owns this device's data
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

/** Stop syncing for good in this page (used right before the page rewrites notes and reloads — restore, sign-out). */
export function haltNotesSync(): void {
  halted = true;
  disconnect();
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
    if (applying || !userId || halted || persistenceFrozen()) return;
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

/** Every tab (leader or not) mirrors the bookkeeping into its sync badge: pending count and anything kept local-only. */
function watchBookkeeping() {
  const read = () => {
    const s = readSyncState();
    if (s) publish(s);
  };
  read();
  window.addEventListener('storage', (e) => {
    if (e.key === SYNC_STATE_KEY && !leader) read();
  });
}

let started = false;

export function startNotesSync(): void {
  if (started || !supabase) return;
  started = true;
  watchBookkeeping();
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
