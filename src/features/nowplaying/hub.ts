/**
 * The service worker's brain for "Now playing": which tab is the one the person is listening to, whether to tell anyone, and when.
 * No browser APIs in here — everything it needs comes in through `deps` — so it runs in the worker and in tests alike.
 *
 *   • Each music tab reports its own state (content.ts). The hub keeps the latest report per tab and picks the CURRENT track:
 *     the tab that most recently started playing (if several play), else the most recent paused one.
 *   • What the new-tab page shows ("your" track) is written out on every change.
 *   • Publishing to the account happens only when detecting is on, sharing isn't "off" and isn't paused, and something is
 *     playing. A new track is held back for a few seconds (skipping through songs publishes nothing), then published; while it
 *     keeps playing it is published again every ~30 s (the database counts a row older than 2 minutes as "not listening").
 *     Pausing, closing the tab, turning sharing off or turning detection off removes it at once.
 *   • Reports carry no tab address; the player (source) is worked out here from the tab's own address, so a message can't claim
 *     to be Spotify, and anything that isn't a recognised player is dropped.
 */
import { type ContentReport, type LocalNow, NO_CONFIG, type NowPlayingConfig, type PublishResult } from './protocol.ts';
import { isSourceId, type SourceId, sourceForUrl } from './sources.ts';
import { cleanTrack, parseTrack, sameTrack, type Track } from './track.ts';

/** A tab that hasn't said anything for this long is gone (content scripts speak every 20 s while playing, 60 s otherwise). */
export const TAB_TTL_MS = 150_000;
/** A new track waits this long before it is published. */
export const PUBLISH_DELAY_MS = 3000;
/** A playing track is published again once this long has passed (the alarm and the tab's own reports both ask). */
export const HEARTBEAT_MS = 25_000;
/** After the database said it has no such table (the migration isn't applied), don't ask again for this long. */
export const UNAVAILABLE_BACKOFF_MS = 10 * 60_000;

export type TabState = { source: SourceId; track: Track; playing: boolean; since: number; seenAt: number };

export type HubDeps = {
  now(): number;
  /** Hand a track to the publisher. */
  publish(track: Track): Promise<PublishResult>;
  /** Tell the publisher to remove whatever is published. */
  clear(): Promise<void>;
  /** The new-tab page's view of "now" changed (or the same thing was seen again). */
  emit(now: LocalNow | null, at: number): void;
  /** Keep the service worker's alarm running (while something is playing or published). */
  setAlarm(on: boolean): void;
  /** The database says this person isn't sharing (set elsewhere): the preference must follow. */
  shareRejected(): void;
  /** Survive a service-worker restart: the open tabs, and "the publisher may hold a track" (so it can still be cleared). */
  save(state: { tabs: Array<[number, TabState]>; held: boolean }): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
};

/** What was saved by `deps.save`, checked (it is our own data, but a stale or odd value must never break the worker). */
export function parseSaved(raw: unknown): { tabs: Array<[number, TabState]>; held: boolean } {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const tabs: Array<[number, TabState]> = [];
  for (const entry of Array.isArray(r.tabs) ? r.tabs.slice(0, 50) : []) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'number' || typeof entry[1] !== 'object' || entry[1] === null) continue;
    const t = entry[1] as Record<string, unknown>;
    const track = parseTrack(t.track);
    if (!track || !isSourceId(t.source) || typeof t.since !== 'number' || typeof t.seenAt !== 'number') continue;
    tabs.push([entry[0], { source: t.source, track, playing: t.playing === true, since: t.since, seenAt: t.seenAt }]);
  }
  return { tabs, held: r.held === true };
}

export class NowPlayingHub {
  private readonly tabs = new Map<number, TabState>();
  private config: NowPlayingConfig = NO_CONFIG;
  /** The publisher may be holding a track of ours. */
  private held: boolean;
  /** The track the publisher confirmed it published. */
  private published: Track | null = null;
  /** The last time we handed it a track (whatever it answered). */
  private attempt: { track: Track; at: number } | null = null;
  private pending: { track: Track; handle: unknown } | null = null;
  private busy = false;
  private blockedUntil = 0;
  private emitted = 'init';
  private saved = '';

  constructor(
    private readonly deps: HubDeps,
    restored: { tabs: Array<[number, TabState]>; held: boolean } = { tabs: [], held: false },
  ) {
    this.held = restored.held;
    for (const [id, tab] of restored.tabs) this.tabs.set(id, tab);
  }

  /** The publisher may be holding a track of ours (so the page that hosts it must stay open). */
  get holdsPublication(): boolean {
    return this.held;
  }

  /** What the new-tab page shows. */
  current(): LocalNow | null {
    const tab = this.pick();
    return tab ? { track: tab.track, playing: tab.playing, shared: tab.playing && this.published !== null && sameTrack(this.published, tab.track) } : null;
  }

  // ── input ──────────────────────────────────────────────────────────────────

  report(tabId: number, tabUrl: unknown, report: ContentReport): void {
    if (!this.config.detect) return;
    const source = sourceForUrl(tabUrl);
    const track = source
      ? cleanTrack({ title: report.title, artist: report.artist, album: report.album, artworkUrl: report.artwork, trackUrl: report.link }, source)
      : null;
    if (!source || !track) {
      this.drop(tabId); // not a player, or a player with nothing to say
      return;
    }
    const now = this.deps.now();
    const prev = this.tabs.get(tabId);
    const starts = report.playing && (!prev?.playing || !sameTrack(prev.track, track));
    this.tabs.set(tabId, { source, track, playing: report.playing, since: starts || !prev ? now : prev.since, seenAt: now });
    this.update();
  }

  tabClosed(tabId: number): void {
    this.drop(tabId);
  }

  setConfig(config: NowPlayingConfig): void {
    const before = this.config;
    this.config = config;
    if (!config.detect) this.tabs.clear();
    if (config.detect !== before.detect || config.share !== before.share || config.paused !== before.paused) this.blockedUntil = 0;
    this.update(true);
  }

  /** The alarm: forget silent tabs, and publish the playing track again if it is time. */
  tick(): void {
    this.update();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private drop(tabId: number): void {
    if (this.tabs.delete(tabId)) this.update();
  }

  private pick(): TabState | null {
    let best: TabState | null = null;
    for (const tab of this.tabs.values()) {
      const better = best === null || (tab.playing && !best.playing) || (tab.playing === best.playing && tab.since > best.since);
      if (better) best = tab;
    }
    return best;
  }

  private wantsShare(): boolean {
    return this.config.detect && this.config.share !== 'off' && !this.config.paused;
  }

  private update(immediate = false): void {
    const now = this.deps.now();
    for (const [id, tab] of this.tabs) if (now - tab.seenAt > TAB_TTL_MS) this.tabs.delete(id);

    const current = this.current();
    const key = JSON.stringify(current);
    // Said again on every update (not only on a change), so the page can tell "still playing" from "the worker lost track".
    this.deps.emit(current, now);
    if (key !== this.emitted) {
      this.emitted = key;
      this.persist();
    }

    const tab = this.pick();
    const playing = tab?.playing ? tab.track : null;
    this.deps.setAlarm(this.config.detect && (this.held || [...this.tabs.values()].some((t) => t.playing)));
    if (!this.wantsShare() || !playing) {
      this.cancelPending();
      if (this.held) void this.stopPublishing();
      return;
    }
    if (now < this.blockedUntil) return;

    if (this.attempt && sameTrack(this.attempt.track, playing)) {
      // Same track as the last time: only a heartbeat is due — or a retry, after a failed one.
      if (now - this.attempt.at >= HEARTBEAT_MS) void this.send(playing);
      return;
    }
    if (this.pending && sameTrack(this.pending.track, playing)) return; // already waiting for this one
    this.cancelPending();
    if (immediate) void this.send(playing);
    else this.pending = { track: playing, handle: this.deps.setTimer(() => this.fire(), PUBLISH_DELAY_MS) };
  }

  private fire(): void {
    const pending = this.pending;
    this.pending = null;
    const tab = this.pick();
    // Still the same track, still playing, still allowed to share?
    if (pending && this.wantsShare() && tab?.playing && sameTrack(tab.track, pending.track)) void this.send(pending.track);
  }

  private cancelPending(): void {
    if (this.pending) this.deps.clearTimer(this.pending.handle);
    this.pending = null;
  }

  private async send(track: Track): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.attempt = { track, at: this.deps.now() };
    // Mark first: if the worker dies mid-request the publisher may hold a track, and it must still be clearable.
    this.held = true;
    this.persist(true);
    let result: PublishResult = 'error';
    try {
      result = await this.deps.publish(track);
    } catch {
      /* treated as an error: retried on the next heartbeat */
    } finally {
      this.busy = false;
    }
    this.published = result === 'ok' ? track : null;
    if (result === 'not-shared' || result === 'unavailable') {
      this.held = false;
      this.persist(true);
      if (result === 'unavailable') this.blockedUntil = this.deps.now() + UNAVAILABLE_BACKOFF_MS;
      else {
        this.config = { ...this.config, share: 'off' }; // act on it now; the preference is rewritten right behind
        this.deps.shareRejected();
      }
    }
    // signed-out / rate-limited / error: tried; the next heartbeat tries again
    this.update();
  }

  private async stopPublishing(): Promise<void> {
    this.held = false;
    this.published = null;
    this.attempt = null;
    this.persist(true);
    try {
      await this.deps.clear();
    } catch {
      /* the row expires by itself within two minutes */
    }
    this.update();
  }

  private persist(force = false): void {
    const state = { tabs: [...this.tabs.entries()], held: this.held };
    const key = JSON.stringify({ tabs: state.tabs.map(([id, t]) => [id, t.track, t.playing, t.since]), held: state.held });
    if (!force && key === this.saved) return;
    this.saved = key;
    this.deps.save(state);
  }
}
