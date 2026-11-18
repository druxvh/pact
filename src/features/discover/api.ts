import type { FeedsResponse } from './types';

export type FeedsErrorCode = 'offline' | 'unauthorized' | 'rate_limited' | 'unavailable';

/** A whole request failed (as opposed to single feeds failing, which come back in `FeedsResponse.failed`). */
export class FeedsError extends Error {
  readonly code: FeedsErrorCode;
  constructor(code: FeedsErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'FeedsError';
    this.code = code;
  }
}

/** What Discover needs from a backend: read some feeds. `supabaseApi` is the real one; `memoryApi` serves fixtures. */
export interface DiscoverApi {
  /** At most 12 https feed URLs. Resolves with what loaded and what didn't; rejects with `FeedsError` when nothing could be asked. */
  fetchFeeds(urls: string[], opts?: { limit?: number }): Promise<FeedsResponse>;
}

let override: DiscoverApi | null = null;
let resolved: Promise<DiscoverApi> | null = null;

/** Tests (and the dev harness) can swap the backend. */
export function setDiscoverApi(api: DiscoverApi | null): void {
  override = api;
  resolved = null;
}

/** How the fixtures behave: normally, or as one of the failure states (to look at them). */
export type MockMode = 'ok' | 'offline' | 'error' | 'empty' | 'slow';
const MOCK_MODES: readonly string[] = ['offline', 'error', 'empty', 'slow'];

/**
 * `?mock=1` on the page (or `?mock=offline|error|empty|slow`), or no backend configured in a dev build, serves the built-in
 * fixtures instead of calling the function. Returns the mode, or null for the real thing.
 */
export function wantsMock(search: string, backendConfigured: boolean, dev: boolean): MockMode | null {
  const v = new URLSearchParams(search).get('mock');
  if (v === '1') return 'ok';
  if (v && MOCK_MODES.includes(v)) return v as MockMode;
  return dev && !backendConfigured ? 'ok' : null;
}

export function getDiscoverApi(): Promise<DiscoverApi> {
  if (override) return Promise.resolve(override);
  resolved ??= (async () => {
    const { isBackendConfigured } = await import('@/lib/supabase/client');
    const search = typeof location === 'undefined' ? '' : location.search;
    const mock = wantsMock(search, isBackendConfigured, import.meta.env.DEV);
    if (mock) return (await import('./memoryApi')).memoryDiscoverApi({ mode: mock });
    return (await import('./supabaseApi')).supabaseDiscoverApi;
  })();
  return resolved;
}

export function describeFeedsError(code: FeedsErrorCode): string {
  switch (code) {
    case 'offline':
      return 'You appear to be offline.';
    case 'unauthorized':
      return 'Sign in again to load articles.';
    case 'rate_limited':
      return 'Too many refreshes — try again in a minute.';
    default:
      return 'The article service isn’t answering right now.';
  }
}
