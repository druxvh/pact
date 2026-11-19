/**
 * The real data layer: the `feeds` Edge Function (supabase/functions/feeds), which fetches the feeds on the server —
 * browsers can't read arbitrary feeds cross-origin, and this keeps the reader's IP address from every publisher.
 * Thin on purpose: validation of the response lives in `logic.ts`.
 */
import { supabase } from '@/lib/supabase/client';
import { type DiscoverApi, FeedsError } from './api';
import { toFeedsResponse } from './logic';

/** supabase-js reports a failed function call as an error object: `context` is the HTTP response, or the call never left the browser. */
function toFeedsError(err: unknown): FeedsError {
  if (err instanceof FeedsError) return err;
  const e = (err ?? {}) as { name?: string; message?: string; context?: { status?: number } };
  const status = e.context?.status;
  if (status === 401 || status === 403) return new FeedsError('unauthorized');
  if (status === 429) return new FeedsError('rate_limited');
  if (e.name === 'FunctionsFetchError' || err instanceof TypeError || /failed to fetch|network/i.test(e.message ?? '')) return new FeedsError('offline');
  return new FeedsError('unavailable');
}

export const supabaseDiscoverApi: DiscoverApi = {
  async fetchFeeds(urls, opts) {
    if (!supabase) throw new FeedsError('unavailable', 'Accounts aren’t set up in this build.');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new FeedsError('offline');
    const { data, error } = await supabase.functions.invoke('feeds', { body: { urls, limit: opts?.limit } });
    if (error) throw toFeedsError(error);
    if (data?.ok === false) throw new FeedsError(data.error === 'rate_limited' ? 'rate_limited' : 'unavailable');
    const response = toFeedsResponse(data);
    if (!response) throw new FeedsError('unavailable');
    return response;
  },
};
