/**
 * Minimal IndexedDB blob store for chat attachments.
 *
 * Why not localStorage? It's ~5 MB total and string-only. The old chat kept `blob:` object URLs
 * in localStorage, which die the moment the page unloads — so every image was permanently
 * broken after a reload. Blobs go here; messages only keep an id.
 */
const DB_NAME = 'pact-chat';
const STORE = 'attachments';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('IndexedDB unavailable'));
    };
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const putBlob = (id: string, blob: Blob) => tx('readwrite', (s) => s.put(blob, id)).then(() => undefined);
export const getBlob = (id: string) => tx<Blob | undefined>('readonly', (s) => s.get(id));
export const deleteBlob = (id: string) => tx('readwrite', (s) => s.delete(id)).then(() => undefined);
export const clearBlobs = () => tx('readwrite', (s) => s.clear()).then(() => undefined);
