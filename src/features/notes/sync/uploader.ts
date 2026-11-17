/**
 * The upload half of notes sync, with every outside dependency injected so it can be tested without a network.
 *
 * Three guarantees the old inline version didn't give:
 *   1. No stale snapshots. Local content and its dirty stamp are read together, in one tick, *per request* — never once
 *      before a series of awaits. (Otherwise an edit made while an earlier chunk was in flight would be uploaded as
 *      the old text under the new stamp, then marked "clean", and the newer text would never be sent.)
 *   2. One bad note can't block the rest. Notes the server's limits would refuse are moved to "local only" up front;
 *      if a batch is still refused for a reason attributable to its rows, it is split until the culprit is alone, and
 *      only that note is set aside. Network / server / auth failures are *not* the note's fault and still abort the
 *      whole upload for a retry.
 *   3. The account is re-checked before every request, so data from another account can never be sent.
 */
import {
  ackDeleted,
  ackUpload,
  buildNoteBatch,
  buildNotebookBatch,
  type Local,
  ownKey,
  type Quarantined,
  quarantineRejected,
  type SyncState,
} from '@/features/notes/sync/model';

/** `permanent` = the server refused these particular rows (row-level data/constraint error). Everything else is retried later. */
export type SendError = { kind: 'transient' | 'permanent' | 'auth'; message: string };

export class UploadFailure extends Error {
  constructor(
    message: string,
    readonly kind: 'transient' | 'auth',
  ) {
    super(message);
    this.name = 'UploadFailure';
  }
}

/** Thrown by `guard` when the signed-in account no longer owns this data. */
export class AccountChanged extends Error {
  constructor() {
    super('The signed-in account changed.');
    this.name = 'AccountChanged';
  }
}

export type UploadDeps = {
  owner: string;
  /** A *fresh* read of the notes store — called again for every request. */
  local: () => Local;
  state: () => SyncState;
  setState: (s: SyncState) => void;
  upsert: (table: 'notebooks' | 'notes', rows: Array<Record<string, unknown>>) => Promise<SendError | null>;
  softDelete: (table: 'notebooks' | 'notes', ids: string[], stamp: string) => Promise<SendError | null>;
  /** Throws (e.g. `AccountChanged`) if it is no longer safe to send this account's data. */
  guard: () => void;
  onQuarantine?: (items: Quarantined[]) => void;
  /** Collects `ownKey`s of what we send, so Realtime echoes of our own writes aren't treated as another device's edits. */
  ownWrites?: Set<string>;
  chunk?: number;
};

/** Postgres error classes that point at the *row* (22 data exception, 23 integrity violation, 54 program limit) and HTTP 413. */
export function classifyError(error: { code?: string; message?: string; status?: number } | null | undefined): SendError | null {
  if (!error) return null;
  const message = error.message || 'The server refused the request.';
  const code = error.code ?? '';
  if (/^(22|23|54)/.test(code) || error.status === 413) return { kind: 'permanent', message };
  if (error.status === 401 || error.status === 403 || code === '42501' || code === 'PGRST301' || /jwt/i.test(message)) return { kind: 'auth', message };
  return { kind: 'transient', message };
}

export async function uploadPending(deps: UploadDeps): Promise<void> {
  const size = deps.chunk ?? 100;
  const tried = new Set<string>();
  const report = (q: Quarantined[]) => {
    if (q.length) deps.onQuarantine?.(q);
  };

  async function sendRows<R extends Record<string, unknown>>(
    kind: 'note' | 'notebook',
    table: 'notebooks' | 'notes',
    rows: Array<{ id: string; stamp: string; row: R }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    deps.guard();
    for (const r of rows) deps.ownWrites?.add(ownKey(kind, r.id, r.stamp));
    const err = await deps.upsert(
      table,
      rows.map((r) => ({ owner_id: deps.owner, ...r.row })),
    );
    if (!err) {
      deps.setState(
        ackUpload(
          deps.state(),
          kind,
          rows.map((r) => [r.id, r.stamp] as const),
        ),
      );
      return;
    }
    if (err.kind !== 'permanent') throw new UploadFailure(err.message, err.kind);
    const only = rows[0];
    if (rows.length === 1 && only) {
      // This note, on its own, is refused: set it aside so everything else can sync.
      deps.setState(quarantineRejected(deps.state(), kind, only.id, `The server refused it: ${err.message}`));
      const title = kind === 'note' ? deps.local().notes.find((n) => n.id === only.id)?.title : deps.local().notebooks.find((b) => b.id === only.id)?.name;
      report([{ kind, id: only.id, title: title ?? '', reason: 'rejected', message: `The server refused it: ${err.message}` }]);
      return;
    }
    const mid = Math.ceil(rows.length / 2);
    await sendRows(kind, table, rows.slice(0, mid));
    await sendRows(kind, table, rows.slice(mid));
  }

  // 1. notebooks first (notes reference them), then 2. notes.
  for (const [kind, table] of [
    ['notebook', 'notebooks'],
    ['note', 'notes'],
  ] as const) {
    for (;;) {
      deps.guard();
      const dirty = kind === 'note' ? deps.state().dirtyNotes : deps.state().dirtyNotebooks;
      const ids = Object.keys(dirty)
        .filter((id) => !tried.has(`${kind}:${id}`))
        .slice(0, size);
      if (ids.length === 0) break;
      for (const id of ids) tried.add(`${kind}:${id}`);
      // content and stamp are read together, right now
      const built = kind === 'note' ? buildNoteBatch(deps.local(), deps.state(), ids) : buildNotebookBatch(deps.local(), deps.state(), ids);
      deps.setState(built.state);
      report(built.quarantined);
      await sendRows(kind, table, built.rows as Array<{ id: string; stamp: string; row: Record<string, unknown> }>);
    }
  }

  // 3. deletions (soft: the row stays, marked deleted, so other devices learn about it)
  for (const [kind, table] of [
    ['note', 'notes'],
    ['notebook', 'notebooks'],
  ] as const) {
    for (;;) {
      deps.guard();
      const gone = kind === 'note' ? deps.state().goneNotes : deps.state().goneNotebooks;
      const ids = Object.keys(gone)
        .filter((id) => !tried.has(`gone:${kind}:${id}`))
        .slice(0, size);
      if (ids.length === 0) break;
      for (const id of ids) tried.add(`gone:${kind}:${id}`);
      const sent = ids.map((id) => [id, gone[id] as string] as const);
      const stamp = sent.map(([, s]) => s).reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
      const err = await deps.softDelete(table, ids, stamp);
      if (err) throw new UploadFailure(err.message, err.kind === 'auth' ? 'auth' : 'transient');
      deps.setState(ackDeleted(deps.state(), kind, sent, stamp));
    }
  }
}
