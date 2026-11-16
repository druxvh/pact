import { useEffect, useState } from 'react';
import type { LinkPreview } from './types';
import { getCommunityApi } from './useCommunityStore';

const cache = new Map<string, LinkPreview | null>();
const inflight = new Map<string, Promise<LinkPreview | null>>();

/** One preview per URL for the whole session (the server caches too), with concurrent requests shared. */
export function loadLinkPreview(url: string): Promise<LinkPreview | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null);
  let p = inflight.get(url);
  if (!p) {
    p = getCommunityApi()
      .fetchLinkPreview(url)
      .catch(() => null)
      .then((r) => {
        cache.set(url, r);
        inflight.delete(url);
        return r;
      });
    inflight.set(url, p);
  }
  return p;
}

export function useLinkPreview(url: string): { preview: LinkPreview | null; loading: boolean } {
  const [state, setState] = useState<{ preview: LinkPreview | null; loading: boolean }>(() => ({ preview: cache.get(url) ?? null, loading: !cache.has(url) }));
  useEffect(() => {
    let cancelled = false;
    if (cache.has(url)) {
      setState({ preview: cache.get(url) ?? null, loading: false });
      return;
    }
    setState({ preview: null, loading: true });
    void loadLinkPreview(url).then((preview) => !cancelled && setState({ preview, loading: false }));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}
