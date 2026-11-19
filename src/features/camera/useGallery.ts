import { useCallback, useEffect, useRef, useState } from 'react';
import { type Capture, gallery, newestFirst } from '@/features/camera/gallery';

export type GalleryState = {
  items: Capture[];
  loaded: boolean;
  /** Storage couldn't be read at all (blocked, private mode): the studio still works, it just can't keep anything. */
  unavailable: boolean;
  add: (capture: Capture) => Promise<void>;
  remove: (id: string) => Promise<void>;
  restore: (capture: Capture) => Promise<void>;
  clear: () => Promise<void>;
  /** The id of the capture just added (for a brief highlight). */
  lastAddedId: string | null;
};

/** The recent captures, newest first, kept in step with what's on disk. Opens fresh each time the studio does. */
export function useGallery(enabled: boolean): GalleryState {
  const [items, setItems] = useState<Capture[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const alive = useRef(true);

  // The brand ring on a fresh capture is a moment, not a state.
  useEffect(() => {
    if (!lastAddedId) return;
    const t = setTimeout(() => setLastAddedId(null), 1800);
    return () => clearTimeout(t);
  }, [lastAddedId]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    let cancelled = false;
    gallery
      .list()
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setUnavailable(true);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [enabled]);

  const add = useCallback(async (capture: Capture) => {
    // Show it right away; if it can't be saved the caller offers a download and this is rolled back.
    setItems((cur) => newestFirst([capture, ...cur]));
    setLastAddedId(capture.id);
    try {
      const { pruned } = await gallery.add(capture);
      if (pruned.length > 0 && alive.current) setItems((cur) => cur.filter((c) => !pruned.includes(c.id)));
    } catch (e) {
      if (alive.current) setItems((cur) => cur.filter((c) => c.id !== capture.id));
      setLastAddedId(null);
      throw e;
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    setItems((cur) => cur.filter((c) => c.id !== id));
    await gallery.remove(id).catch(() => undefined);
  }, []);

  const restore = useCallback(async (capture: Capture) => {
    setItems((cur) => newestFirst([capture, ...cur.filter((c) => c.id !== capture.id)]));
    await gallery.restore(capture).catch(() => undefined);
  }, []);

  const clear = useCallback(async () => {
    setItems([]);
    await gallery.clear().catch(() => undefined);
  }, []);

  return { items, loaded, unavailable, add, remove, restore, clear, lastAddedId };
}
