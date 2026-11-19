/**
 * Writes the person's current track to their account — and removes it — on behalf of the service worker. It runs where the
 * Supabase session is (the offscreen page on Chromium, the background page on Firefox; see publisher-page.ts), because a
 * service worker has no localStorage and so no session.
 *
 * It only ever does what it is told, and is told only when the person turned sharing on. Signed out, it does nothing at all:
 * the session is looked up locally and no request is made. The track it is handed has already been cleaned (hub.ts, track.ts).
 */
import type { PublishResult } from './protocol.ts';
import type { Track } from './track.ts';

type DbError = { code?: string; message?: string } | null;

/** The slice of the Supabase client this needs (the real client is cast to it, as the VibeParty host does). */
export type PublisherClient = {
  auth: { getSession(): Promise<{ data: { session: { user: { id: string } } | null } }> };
  from(table: 'now_playing'): {
    upsert(row: Record<string, unknown>, options: { onConflict: string }): PromiseLike<{ error: DbError }>;
    delete(): { eq(column: string, value: string): PromiseLike<{ error: DbError }> };
  };
};

/** Map the database's answer to what the service worker needs to know. */
export function classify(error: DbError): PublishResult {
  if (!error) return 'ok';
  const text = `${error.code ?? ''} ${error.message ?? ''}`;
  if (/rate_limited/i.test(text)) return 'rate-limited';
  // 42501 = refused by row-level security / grants: the account says "don't share" (changed on another device, or never set).
  if (error.code === '42501' || /row-level security|permission denied/i.test(text)) return 'not-shared';
  // The table isn't there yet (the migration hasn't been applied to this project).
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST204' || /does not exist|schema cache|could not find/i.test(text))
    return 'unavailable';
  return 'error';
}

export class NowPlayingPublisher {
  constructor(private readonly client: PublisherClient | null) {}

  /** Anything published and not yet cleared (keeps the page that hosts this from being closed). */
  active = false;

  private async userId(): Promise<string | null> {
    try {
      return (await this.client?.auth.getSession())?.data.session?.user.id ?? null;
    } catch {
      return null;
    }
  }

  async publish(track: Track): Promise<PublishResult> {
    if (!this.client) return 'unavailable'; // no backend in this build
    const userId = await this.userId();
    if (!userId) return 'signed-out'; // nothing is sent
    try {
      const { error } = await this.client.from('now_playing').upsert(
        {
          user_id: userId,
          title: track.title,
          artist: track.artist,
          album: track.album,
          artwork_url: track.artworkUrl,
          track_url: track.trackUrl,
          source: track.source,
        },
        { onConflict: 'user_id' },
      );
      const result = classify(error);
      if (result === 'ok') this.active = true;
      return result;
    } catch {
      return 'error'; // offline: the next heartbeat tries again
    }
  }

  async clear(): Promise<void> {
    this.active = false;
    const userId = await this.userId();
    if (!userId || !this.client) return;
    try {
      await this.client.from('now_playing').delete().eq('user_id', userId);
    } catch {
      /* offline: the row stops counting as "listening" by itself within two minutes */
    }
  }

  handle(cmd: { type: 'nowplaying-host:publish'; track: Track } | { type: 'nowplaying-host:clear' }): Promise<PublishResult | { ok: true }> {
    return cmd.type === 'nowplaying-host:publish' ? this.publish(cmd.track) : this.clear().then(() => ({ ok: true as const }));
  }
}
