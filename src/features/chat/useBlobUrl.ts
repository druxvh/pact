import { useEffect, useState } from 'react';
import { getBlob } from '@/features/chat/idb';

export type BlobState = { url: string | null; status: 'loading' | 'ready' | 'missing' };

/** Resolve an attachment id to an object URL (and revoke it on unmount) — see idb.ts for why. */
export function useBlobUrl(id: string | undefined): BlobState {
  const [state, setState] = useState<BlobState>({ url: null, status: 'loading' });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let created: string | null = null;
    setState({ url: null, status: 'loading' });
    getBlob(id)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) return setState({ url: null, status: 'missing' });
        created = URL.createObjectURL(blob);
        setState({ url: created, status: 'ready' });
      })
      .catch(() => !cancelled && setState({ url: null, status: 'missing' }));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [id]);

  return state;
}
