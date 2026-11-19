/** A tiny IndexedDB blob store for user-chosen assets that are too big for localStorage (e.g. the wallpaper image). */
const DB = 'pact-assets';
const STORE = 'blobs';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const putAsset = (id: string, blob: Blob) => run('readwrite', (s) => s.put(blob, id)).then(() => undefined);
export const getAsset = (id: string) => run<Blob | undefined>('readonly', (s) => s.get(id));
export const deleteAsset = (id: string) => run('readwrite', (s) => s.delete(id)).then(() => undefined);
export const clearAssets = () => run('readwrite', (s) => s.clear()).then(() => undefined);
