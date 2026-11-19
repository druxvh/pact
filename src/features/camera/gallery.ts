/**
 * The camera's recent captures: photos and clips kept on this device, newest first, capped.
 *
 * Blobs live in IndexedDB (localStorage is ~5 MB and string-only). The two existing IDB helpers (`lib/assets.ts`, the chat's
 * `idb.ts`) are put/get/delete by key — neither can list — so the gallery has its own tiny database. The rules (cap, ordering,
 * pruning) are written against a small `GalleryBackend` so they can be tested without IndexedDB.
 */
export type CaptureKind = 'photo' | 'video';

export type Capture = {
  id: string;
  kind: CaptureKind;
  blob: Blob;
  /** A small JPEG for the filmstrip (a video's poster frame). */
  thumb: Blob;
  mime: string;
  width: number;
  height: number;
  /** Bytes on disk: the file plus its thumbnail. */
  size: number;
  /** Videos only. */
  durationMs?: number;
  createdAt: number;
};

/** Most captures kept; the oldest go first. */
export const MAX_CAPTURES = 24;
/** Most bytes kept (clips are big). The newest capture is always kept, however large. */
export const MAX_GALLERY_BYTES = 1024 * 1024 * 1024;

export type Caps = { maxItems: number; maxBytes: number };
export const DEFAULT_CAPS: Caps = { maxItems: MAX_CAPTURES, maxBytes: MAX_GALLERY_BYTES };

export const newestFirst = <T extends { createdAt: number; id: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));

/** Which captures to delete so the rest fit the caps: oldest first, never the newest one. */
export function planPrune(items: ReadonlyArray<Pick<Capture, 'id' | 'size' | 'createdAt'>>, caps: Caps = DEFAULT_CAPS): string[] {
  const sorted = newestFirst(items);
  const keep: typeof sorted = [];
  let bytes = 0;
  for (const item of sorted) {
    const fits = keep.length < caps.maxItems && (keep.length === 0 || bytes + item.size <= caps.maxBytes);
    if (!fits) continue;
    keep.push(item);
    bytes += item.size;
  }
  const kept = new Set(keep.map((k) => k.id));
  return sorted.filter((i) => !kept.has(i.id)).map((i) => i.id);
}

export type GalleryBackend = {
  getAll: () => Promise<Capture[]>;
  put: (capture: Capture) => Promise<void>;
  delete: (id: string) => Promise<void>;
  clear: () => Promise<void>;
};

export function createGallery(backend: GalleryBackend, caps: Caps = DEFAULT_CAPS) {
  return {
    /** Newest first. */
    list: async (): Promise<Capture[]> => newestFirst(await backend.getAll()),
    /** Save one, then drop whatever no longer fits. Resolves with what was dropped. */
    async add(capture: Capture): Promise<{ pruned: string[] }> {
      await backend.put(capture);
      const all = await backend.getAll();
      const pruned = planPrune(all, caps).filter((id) => id !== capture.id);
      await Promise.all(pruned.map((id) => backend.delete(id)));
      return { pruned };
    },
    /** Put one back (undo of a delete): keeps its original time, so it lands where it was. */
    restore: (capture: Capture) => backend.put(capture),
    remove: (id: string) => backend.delete(id),
    clear: () => backend.clear(),
  };
}

export const captureId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ── IndexedDB backend ────────────────────────────────────────────────────────

const DB_NAME = 'pact-camera';
const STORE = 'captures';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading or the browser reclaiming the DB: forget the handle so the next call reopens.
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('IndexedDB unavailable'));
    };
  });
  // No IndexedDB at all (or it threw): don't keep handing out the same failure.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const req = run(transaction.objectStore(STORE));
    // Resolve on `complete` for writes (the data is durable), on success for reads.
    if (mode === 'readwrite') {
      transaction.oncomplete = () => resolve(req.result);
      transaction.onabort = () => reject(transaction.error ?? new Error('Storage write was aborted'));
    } else {
      req.onsuccess = () => resolve(req.result);
    }
    req.onerror = () => reject(req.error);
  });
}

export const idbBackend: GalleryBackend = {
  getAll: () => tx<Capture[]>('readonly', (s) => s.getAll()),
  put: (c) => tx('readwrite', (s) => s.put(c)).then(() => undefined),
  delete: (id) => tx('readwrite', (s) => s.delete(id)).then(() => undefined),
  clear: () => tx('readwrite', (s) => s.clear()).then(() => undefined),
};

export const gallery = createGallery(idbBackend);

/** Delete every capture (account switch, "Erase everything"). Never throws. */
export const clearCaptures = (): Promise<void> => gallery.clear().catch(() => undefined);

/** Is this the browser telling us the disk (or the site's quota) is full? */
export function isQuotaError(e: unknown): boolean {
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}
