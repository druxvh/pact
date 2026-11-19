import { describe, expect, it } from 'vitest';
import {
  type Capture,
  createGallery,
  DEFAULT_CAPS,
  type GalleryBackend,
  isQuotaError,
  MAX_CAPTURES,
  MAX_GALLERY_BYTES,
  newestFirst,
  planPrune,
} from '@/features/camera/gallery';

const cap = (id: string, createdAt: number, size = 1000, kind: Capture['kind'] = 'photo'): Capture => ({
  id,
  kind,
  blob: new Blob(['x']),
  thumb: new Blob(['t']),
  mime: kind === 'photo' ? 'image/jpeg' : 'video/webm',
  width: 1280,
  height: 720,
  size,
  createdAt,
});

/** An in-memory stand-in for the IndexedDB store. */
function memoryBackend(initial: Capture[] = []) {
  const map = new Map(initial.map((c) => [c.id, c]));
  const backend: GalleryBackend = {
    getAll: async () => [...map.values()],
    put: async (c) => void map.set(c.id, c),
    delete: async (id) => void map.delete(id),
    clear: async () => map.clear(),
  };
  return { backend, map };
}

describe('the caps', () => {
  it('are 24 captures and 1 GB', () => {
    expect(MAX_CAPTURES).toBe(24);
    expect(MAX_GALLERY_BYTES).toBe(1024 ** 3);
    expect(DEFAULT_CAPS).toEqual({ maxItems: 24, maxBytes: 1024 ** 3 });
  });
});

describe('newestFirst', () => {
  it('orders by time, newest first, and is stable for equal times', () => {
    const list = [cap('a', 1), cap('c', 3), cap('b', 2), cap('d', 3)];
    expect(newestFirst(list).map((c) => c.id)).toEqual(['d', 'c', 'b', 'a']);
  });
});

describe('planPrune', () => {
  it('keeps everything under the caps', () => {
    expect(planPrune([cap('a', 1), cap('b', 2)])).toEqual([]);
  });

  it('drops the oldest beyond the count cap', () => {
    const items = Array.from({ length: 30 }, (_, i) => cap(`c${i}`, i));
    const drop = planPrune(items);
    expect(drop).toHaveLength(6);
    expect(drop).toEqual(['c5', 'c4', 'c3', 'c2', 'c1', 'c0']);
  });

  it('drops the oldest beyond the byte cap', () => {
    const items = [cap('old', 1, 600), cap('mid', 2, 600), cap('new', 3, 600)];
    expect(planPrune(items, { maxItems: 24, maxBytes: 1300 })).toEqual(['old']);
  });

  it('always keeps the newest capture, even when it alone is over the byte cap', () => {
    const items = [cap('old', 1, 100), cap('huge', 2, 5000)];
    expect(planPrune(items, { maxItems: 24, maxBytes: 1000 })).toEqual(['old']);
  });

  it('is not fooled by input order', () => {
    const items = [cap('b', 2), cap('a', 1), cap('c', 3)];
    expect(planPrune(items, { maxItems: 2, maxBytes: 1e9 })).toEqual(['a']);
  });
});

describe('the gallery over a backend', () => {
  it('lists newest first', async () => {
    const { backend } = memoryBackend([cap('a', 1), cap('b', 3), cap('c', 2)]);
    expect((await createGallery(backend).list()).map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('keeps only the latest 24 when more are added', async () => {
    const { backend, map } = memoryBackend();
    const g = createGallery(backend);
    for (let i = 0; i < 30; i++) await g.add(cap(`c${i}`, i));
    expect(map.size).toBe(24);
    expect(map.has('c0')).toBe(false);
    expect(map.has('c5')).toBe(false);
    expect(map.has('c6')).toBe(true);
    expect(map.has('c29')).toBe(true);
  });

  it('says what it dropped, and never drops the one just added', async () => {
    const { backend } = memoryBackend([cap('a', 10, 600), cap('b', 20, 600)]);
    const g = createGallery(backend, { maxItems: 24, maxBytes: 1000 });
    const { pruned } = await g.add(cap('c', 30, 900));
    expect(pruned).toEqual(['b', 'a']);
    expect((await g.list()).map((c) => c.id)).toEqual(['c']);
  });

  it('keeps a large clip and drops older ones to make room (byte cap)', async () => {
    const { backend } = memoryBackend();
    const g = createGallery(backend, { maxItems: 24, maxBytes: 10_000 });
    await g.add(cap('p1', 1, 3000));
    await g.add(cap('p2', 2, 3000));
    await g.add(cap('v1', 3, 9000, 'video'));
    expect((await g.list()).map((c) => c.id)).toEqual(['v1']);
  });

  it('remove, restore (keeps its original time) and clear', async () => {
    const { backend } = memoryBackend();
    const g = createGallery(backend);
    const a = cap('a', 1);
    await g.add(a);
    await g.add(cap('b', 2));
    await g.remove('a');
    expect((await g.list()).map((c) => c.id)).toEqual(['b']);
    await g.restore(a);
    expect((await g.list()).map((c) => [c.id, c.createdAt])).toEqual([
      ['b', 2],
      ['a', 1],
    ]);
    await g.clear();
    expect(await g.list()).toEqual([]);
  });
});

describe('isQuotaError', () => {
  it('recognises the browser saying the disk is full', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError(new Error('other'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});
