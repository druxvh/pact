import { describe, expect, it, vi } from 'vitest';
import { classify, NowPlayingPublisher, type PublisherClient } from './publisher';
import type { Track } from './track';

const track: Track = {
  title: 'Night Drive',
  artist: 'The Tests',
  album: 'Fixtures',
  artworkUrl: 'https://i.scdn.co/image/a',
  trackUrl: 'https://open.spotify.com/track/1',
  source: 'spotify',
};
const USER = '11111111-1111-4111-8111-111111111111';

function fake(opts: { session?: boolean; error?: { code?: string; message?: string } | null; reject?: boolean } = {}) {
  const upserts: Array<{ row: Record<string, unknown>; options: unknown }> = [];
  const deletes: Array<[string, string]> = [];
  const client: PublisherClient = {
    auth: { getSession: vi.fn(async () => ({ data: { session: opts.session === false ? null : { user: { id: USER } } } })) },
    from: () => ({
      upsert: async (row, options) => {
        if (opts.reject) throw new Error('Failed to fetch');
        upserts.push({ row, options });
        return { error: opts.error ?? null };
      },
      delete: () => ({
        eq: async (column, value) => {
          deletes.push([column, value]);
          return { error: null };
        },
      }),
    }),
  };
  return { client, upserts, deletes };
}

describe('publishing', () => {
  it('upserts exactly the clean track under the signed-in user — and nothing else about the person', async () => {
    const f = fake();
    const p = new NowPlayingPublisher(f.client);
    expect(await p.publish(track)).toBe('ok');
    expect(f.upserts).toEqual([
      {
        row: {
          user_id: USER,
          title: 'Night Drive',
          artist: 'The Tests',
          album: 'Fixtures',
          artwork_url: 'https://i.scdn.co/image/a',
          track_url: 'https://open.spotify.com/track/1',
          source: 'spotify',
        },
        options: { onConflict: 'user_id' },
      },
    ]);
    expect(p.active).toBe(true);
  });

  it('signed out: nothing is sent at all', async () => {
    const f = fake({ session: false });
    const p = new NowPlayingPublisher(f.client);
    expect(await p.publish(track)).toBe('signed-out');
    expect(f.upserts).toHaveLength(0);
    expect(p.active).toBe(false);
  });

  it('no backend in this build', async () => {
    expect(await new NowPlayingPublisher(null).publish(track)).toBe('unavailable');
    await expect(new NowPlayingPublisher(null).clear()).resolves.toBeUndefined();
  });

  it('a dropped connection is an error to retry, not an exception', async () => {
    const p = new NowPlayingPublisher(fake({ reject: true }).client);
    expect(await p.publish(track)).toBe('error');
    expect(p.active).toBe(false);
  });

  it('removes the row on clear — and sends nothing when signed out', async () => {
    const f = fake();
    const p = new NowPlayingPublisher(f.client);
    await p.publish(track);
    await p.clear();
    expect(f.deletes).toEqual([['user_id', USER]]);
    expect(p.active).toBe(false);

    const out = fake({ session: false });
    await new NowPlayingPublisher(out.client).clear();
    expect(out.deletes).toHaveLength(0);
  });

  it('handles the two host commands', async () => {
    const f = fake();
    const p = new NowPlayingPublisher(f.client);
    expect(await p.handle({ type: 'nowplaying-host:publish', track })).toBe('ok');
    expect(await p.handle({ type: 'nowplaying-host:clear' })).toEqual({ ok: true });
    expect(f.deletes).toHaveLength(1);
  });
});

describe('classify (the database’s answer)', () => {
  it('maps what each failure means to the service worker', () => {
    expect(classify(null)).toBe('ok');
    expect(classify({ code: '42501', message: 'new row violates row-level security policy' })).toBe('not-shared');
    expect(classify({ message: 'permission denied for table now_playing' })).toBe('not-shared');
    expect(classify({ code: 'P0001', message: 'rate_limited' })).toBe('rate-limited');
    expect(classify({ code: '42P01', message: 'relation "public.now_playing" does not exist' })).toBe('unavailable');
    expect(classify({ code: 'PGRST205', message: 'Could not find the table' })).toBe('unavailable');
    expect(classify({ code: '23514', message: 'violates check constraint' })).toBe('error');
    expect(classify({ message: 'Failed to fetch' })).toBe('error');
  });
});
