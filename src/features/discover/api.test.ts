import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeFeedsError, FeedsError, getDiscoverApi, setDiscoverApi, wantsMock } from './api';
import { CATALOG } from './catalog';
import { toFeedsResponse } from './logic';
import { memoryDiscoverApi } from './memoryApi';

describe('which backend Discover talks to', () => {
  it('uses the fixtures for ?mock=1 and the failure-state modes, or in a dev build with no backend', () => {
    expect(wantsMock('?mock=1', true, false)).toBe('ok');
    expect(wantsMock('?x=1&mock=offline', true, false)).toBe('offline');
    expect(wantsMock('?mock=error', true, false)).toBe('error');
    expect(wantsMock('?mock=empty', true, false)).toBe('empty');
    expect(wantsMock('?mock=slow', true, false)).toBe('slow');
    expect(wantsMock('', false, true)).toBe('ok');
  });

  it('uses the real function otherwise — including in a build with no backend (accounts, and so this page, aren’t available there)', () => {
    expect(wantsMock('', true, true)).toBeNull();
    expect(wantsMock('', true, false)).toBeNull();
    expect(wantsMock('', false, false)).toBeNull();
    expect(wantsMock('?mock=0', true, true)).toBeNull();
    expect(wantsMock('?mock=<script>', true, false)).toBeNull();
  });

  afterEach(() => setDiscoverApi(null));

  it('lets a test or harness swap it', async () => {
    const api = memoryDiscoverApi({ delayMs: 0 });
    setDiscoverApi(api);
    expect(await getDiscoverApi()).toBe(api);
  });

  it('says what went wrong in words', () => {
    for (const code of ['offline', 'unauthorized', 'rate_limited', 'unavailable'] as const) expect(describeFeedsError(code).length).toBeGreaterThan(10);
    expect(new FeedsError('offline').code).toBe('offline');
  });
});

describe('the fixtures can fail on purpose, to look at the failure states', () => {
  const urls = [CATALOG[0]?.feed as string];
  it('offline and error reject; empty returns feeds with nothing in them', async () => {
    await expect(memoryDiscoverApi({ delayMs: 0, mode: 'offline' }).fetchFeeds(urls)).rejects.toMatchObject({ code: 'offline' });
    await expect(memoryDiscoverApi({ delayMs: 0, mode: 'error' }).fetchFeeds(urls)).rejects.toMatchObject({ code: 'unavailable' });
    expect(await memoryDiscoverApi({ delayMs: 0, mode: 'empty' }).fetchFeeds(urls)).toEqual({ feeds: [], failed: [{ url: urls[0], reason: 'empty' }] });
  });

  it('slow waits (fake clock)', async () => {
    vi.useFakeTimers();
    const p = memoryDiscoverApi({ delayMs: 0, mode: 'slow' }).fetchFeeds(urls);
    let done = false;
    void p.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(true);
    vi.useRealTimers();
  });

  it('a real-shaped response from the fixtures survives the client-side validation (with https pictures)', async () => {
    const res = await memoryDiscoverApi({ delayMs: 0 }).fetchFeeds(urls);
    const asServer = { ok: true, ...res, feeds: res.feeds.map((f) => ({ ...f, items: f.items.map((i) => ({ ...i, image: null })) })) };
    expect(toFeedsResponse(asServer)?.feeds[0]?.items.length).toBeGreaterThan(3);
  });
});
