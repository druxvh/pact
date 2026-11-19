/**
 * Where snapshots live: IndexedDB (localStorage is far too small and string-only, and a snapshot can carry a
 * wallpaper picture). Two object stores so listing never has to load the payloads: `meta` (small) and `body`
 * (the stored JSON per key and the wallpaper blob). Connections are opened per operation and closed after, so
 * wiping the database on an account switch can never be blocked by an open handle.
 */
import type { SnapshotMeta, SnapshotRecord, WallpaperMedia } from '@/lib/backup/types';

const DB_NAME = 'pact-backups';
const META = 'meta';
const BODY = 'body';

type Body = { id: string; data: Record<string, string>; wallpaper: WallpaperMedia | null };

export type SnapshotDb = {
  list(): Promise<SnapshotMeta[]>;
  get(id: string): Promise<SnapshotRecord | undefined>;
  put(record: SnapshotRecord): Promise<void>;
  delete(ids: string[]): Promise<void>;
  clear(): Promise<void>;
};

const splitRecord = ({ data, wallpaper, ...meta }: SnapshotRecord): { meta: SnapshotMeta; body: Body } => ({ meta, body: { id: meta.id, data, wallpaper } });

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META, { keyPath: 'id' });
      req.result.createObjectStore(BODY, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

async function withTx<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => Promise<T> | T): Promise<T> {
  const db = await open();
  try {
    const tx = db.transaction(stores, mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    });
    const result = await fn(tx);
    await done;
    return result;
  } finally {
    db.close();
  }
}

const wrap = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export function idbSnapshotDb(): SnapshotDb {
  return {
    list: () => withTx([META], 'readonly', (tx) => wrap<SnapshotMeta[]>(tx.objectStore(META).getAll())),
    get: (id) =>
      withTx([META, BODY], 'readonly', async (tx) => {
        const [meta, body] = await Promise.all([
          wrap<SnapshotMeta | undefined>(tx.objectStore(META).get(id)),
          wrap<Body | undefined>(tx.objectStore(BODY).get(id)),
        ]);
        return meta && body ? { ...meta, data: body.data, wallpaper: body.wallpaper } : undefined;
      }),
    put: (record) =>
      withTx([META, BODY], 'readwrite', (tx) => {
        const { meta, body } = splitRecord(record);
        tx.objectStore(META).put(meta);
        tx.objectStore(BODY).put(body);
      }),
    delete: (ids) =>
      withTx([META, BODY], 'readwrite', (tx) => {
        for (const id of ids) {
          tx.objectStore(META).delete(id);
          tx.objectStore(BODY).delete(id);
        }
      }),
    clear: () =>
      withTx([META, BODY], 'readwrite', (tx) => {
        tx.objectStore(META).clear();
        tx.objectStore(BODY).clear();
      }),
  };
}

/** An in-memory implementation with the same behaviour — for tests. */
export function memorySnapshotDb(): SnapshotDb {
  const store = new Map<string, SnapshotRecord>();
  return {
    list: async () => [...store.values()].map(({ data: _d, wallpaper: _w, ...meta }) => meta),
    get: async (id) => store.get(id),
    put: async (record) => {
      store.set(record.id, record);
    },
    delete: async (ids) => {
      for (const id of ids) store.delete(id);
    },
    clear: async () => store.clear(),
  };
}

/** Remove every snapshot (an account switch must not leave the previous person's backups behind). */
export const clearSnapshots = (): Promise<void> => idbSnapshotDb().clear();
