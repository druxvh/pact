/**
 * Keeps this tab's YouTube `<video>` in step with the room.
 *
 * What changed from the first version, and why:
 *  • Echo suppression used a fixed 250 ms "I'm applying a remote command" lock. Real `seeked`/`play` events
 *    often land later than that, so remote actions bounced back to everyone. Now we *expect* the specific
 *    events our own change will cause and swallow exactly those.
 *  • It listened to `seeking` (fires on every scrubber step) — now `seeked`, debounced to the final position.
 *  • A 2 s "state heartbeat" was emitted and then dropped by its only consumer — removed.
 *  • A MutationObserver on the whole YouTube DOM (hundreds of mutations a second) found the video — replaced
 *    by a 1 s poll that only does work while a party is active.
 *  • Ads play in the same <video>: their play/pause/seek must not reach the room, and remote commands must
 *    not seek an ad. We detect `ad-showing`, sit out, and ask for a fresh position when it ends.
 *  • Remote commands that arrive before the player has metadata (full-page navigation) are kept and applied
 *    once it's ready, extrapolated for the wait.
 *  • Playback speed is locked to 1× while in a party (drift is corrected by ±5 % nudges), so everyone stays in sync.
 *
 * Nothing here touches the page unless `setActive(true)` — outside a party YouTube is left completely alone.
 */
import { type MediaEventName, parseYouTubeId } from './protocol.ts';

export type LocalMediaEvent = { ev: MediaEventName; mediaTime: number; playing: boolean; videoId: string | null };
export type RemoteSync = { playing: boolean; mediaTime: number; videoId: string | null };

export type SyncEngineOptions = {
  onLocalEvent(event: LocalMediaEvent): void;
  /** The room is watching a different video than this tab. */
  onVideoMismatch(roomVideoId: string): void;
  onAdChange?(showing: boolean): void;
  /** The player has (re)loaded or an ad just ended — ask the room where the video is. */
  onNeedResync?(): void;
  /** The browser refused to start playback without a user gesture. */
  onPlayBlocked?(): void;
  // Seams for tests:
  findVideo?(): HTMLVideoElement | null;
  isAdShowing?(): boolean;
  getVideoId?(): string | null;
};

export const SYNC = {
  /** How long we wait for the event our own change causes before deciding it isn't coming. */
  expectTtlMs: 2_000,
  seekDebounceMs: 200,
  resyncDelayMs: 1_200,
  tickMs: 1_000,
  /** Applying a remote command while playing: only jump if further off than this (smaller gaps drift-correct). */
  applyJumpS: 0.75,
  /** Paused: land exactly. */
  pausedToleranceS: 0.05,
  driftHardS: 2,
  driftSoftS: 0.25,
  nudgeFast: 1.05,
  nudgeSlow: 0.95,
  /** A remote command that can't be applied yet (player not ready) is kept this long. */
  pendingTtlMs: 20_000,
} as const;

type Watched = 'play' | 'pause' | 'seeked';

const defaultFindVideo = () => document.querySelector<HTMLVideoElement>('#movie_player video, video.html5-main-video');
const defaultIsAd = () => document.querySelector('.html5-video-player.ad-showing, .html5-video-player.ad-interrupting') !== null;
const defaultVideoId = () => parseYouTubeId(location.href);

export function getYouTubeVideoId(): string | null {
  return defaultVideoId();
}

export class SyncEngine {
  private active = false;
  private video: HTMLVideoElement | null = null;
  private bound: Array<[string, EventListener]> = [];
  private readonly expected = new Map<Watched, number>();
  private anchor: { mediaTime: number; at: number; playing: boolean } | null = null;
  private pending: { cmd: RemoteSync; receivedAt: number; until: number } | null = null;
  private seekTimer: ReturnType<typeof setTimeout> | undefined;
  private resyncTimer: ReturnType<typeof setTimeout> | undefined;
  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private adShowing = false;
  private lastVideoId: string | null = null;
  private nudged = false;

  private readonly find: () => HTMLVideoElement | null;
  private readonly isAd: () => boolean;
  private readonly getVideoId: () => string | null;

  constructor(private readonly options: SyncEngineOptions) {
    this.find = options.findVideo ?? defaultFindVideo;
    this.isAd = options.isAdShowing ?? defaultIsAd;
    this.getVideoId = options.getVideoId ?? defaultVideoId;
  }

  /** Turn syncing on (we joined a party) or off (we left it). */
  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (on) {
      this.lastVideoId = this.getVideoId();
      this.tick();
      this.tickTimer = setInterval(() => this.tick(), SYNC.tickMs);
      return;
    }
    clearInterval(this.tickTimer);
    clearTimeout(this.seekTimer);
    clearTimeout(this.resyncTimer);
    this.tickTimer = this.seekTimer = this.resyncTimer = undefined;
    this.pending = null;
    this.anchor = null;
    this.expected.clear();
    this.adShowing = false;
    if (this.nudged && this.video) this.video.playbackRate = 1;
    this.nudged = false;
    this.detach();
  }

  dispose(): void {
    this.setActive(false);
  }

  /** Where the room's video is "right now" (the sender already extrapolated). */
  applyRemote(cmd: RemoteSync): void {
    if (!this.active) return;
    const now = Date.now();
    this.pending = { cmd, receivedAt: now, until: now + SYNC.pendingTtlMs };
    clearTimeout(this.resyncTimer); // we have fresh info; no need to ask
    this.flush();
  }

  // ── applying remote state ───────────────────────────────────────────────────

  private flush(): void {
    const p = this.pending;
    if (!p) return;
    const now = Date.now();
    if (now > p.until) {
      this.pending = null;
      return;
    }
    const v = this.ensureVideo();
    if (!v || v.readyState < 1 || this.adShowing) return; // keep it; tick() retries

    if (p.cmd.videoId && p.cmd.videoId !== this.getVideoId()) {
      this.pending = null;
      this.options.onVideoMismatch(p.cmd.videoId);
      return;
    }
    this.pending = null;

    // If we had to wait for the player, the room's position moved on while we waited.
    const waited = p.cmd.playing ? (now - p.receivedAt) / 1000 : 0;
    let target = p.cmd.mediaTime + waited;
    if (Number.isFinite(v.duration)) target = Math.min(target, v.duration);
    target = Math.max(0, target);

    const tolerance = p.cmd.playing ? SYNC.applyJumpS : SYNC.pausedToleranceS;
    if (Math.abs(v.currentTime - target) > tolerance) {
      this.expect('seeked');
      v.currentTime = target;
    }
    if (v.playbackRate !== 1) v.playbackRate = 1;

    if (p.cmd.playing && v.paused) {
      this.expect('play');
      void v.play().catch((err: unknown) => {
        this.expected.delete('play');
        if ((err as { name?: string })?.name === 'NotAllowedError') this.options.onPlayBlocked?.();
      });
    } else if (!p.cmd.playing && !v.paused) {
      this.expect('pause');
      v.pause();
    }
    this.anchor = { mediaTime: target, at: now, playing: p.cmd.playing };
  }

  // ── local events → room ─────────────────────────────────────────────────────

  private expect(type: Watched): void {
    this.expected.set(type, Date.now() + SYNC.expectTtlMs);
  }

  /** True if this event is the echo of a change WE made, and should not be reported. */
  private consume(type: Watched): boolean {
    const until = this.expected.get(type);
    if (until === undefined) return false;
    this.expected.delete(type);
    return until >= Date.now();
  }

  private onLocal(type: Watched | 'ended'): void {
    if (!this.active || this.adShowing) return;
    const v = this.video;
    if (!v) return;
    if (type !== 'ended' && this.consume(type)) return;

    clearTimeout(this.resyncTimer); // the local viewer is steering now; don't second-guess them

    if (type === 'seeked') {
      clearTimeout(this.seekTimer);
      this.seekTimer = setTimeout(() => this.emit('seek'), SYNC.seekDebounceMs);
      return;
    }
    if (type === 'pause' && v.ended) return; // `ended` follows and says it better
    this.emit(type === 'play' ? 'play' : type === 'pause' ? 'pause' : 'ended');
  }

  private emit(ev: MediaEventName): void {
    const v = this.video;
    if (!v || !this.active || this.adShowing) return;
    const playing = ev === 'play' ? true : ev === 'pause' || ev === 'ended' ? false : !v.paused && !v.ended;
    this.anchor = { mediaTime: v.currentTime, at: Date.now(), playing };
    this.options.onLocalEvent({ ev, mediaTime: v.currentTime, playing, videoId: this.getVideoId() });
  }

  // ── housekeeping ────────────────────────────────────────────────────────────

  private tick(): void {
    if (!this.active) return;
    const v = this.ensureVideo();

    const ad = this.isAd();
    if (ad !== this.adShowing) {
      this.adShowing = ad;
      this.options.onAdChange?.(ad);
      if (!ad) this.scheduleResync();
    }

    const id = this.getVideoId();
    if (id !== this.lastVideoId) {
      this.lastVideoId = id; // SPA navigation: the old anchor belongs to the previous video
      this.anchor = null;
    }

    this.flush();
    this.correctDrift(v);
  }

  private correctDrift(v: HTMLVideoElement | null): void {
    if (!v || this.adShowing || !this.anchor?.playing) return;
    if (v.paused || v.ended || v.seeking || v.readyState < 3) return; // buffering — don't fight it

    const expected = this.anchor.mediaTime + (Date.now() - this.anchor.at) / 1000;
    const drift = v.currentTime - expected;
    const magnitude = Math.abs(drift);

    if (magnitude > SYNC.driftHardS) {
      this.expect('seeked');
      v.currentTime = Math.max(0, expected);
      this.setRate(v, 1);
    } else if (magnitude > SYNC.driftSoftS) {
      this.setRate(v, drift > 0 ? SYNC.nudgeSlow : SYNC.nudgeFast);
    } else {
      this.setRate(v, 1);
    }
  }

  private setRate(v: HTMLVideoElement, rate: number): void {
    if (Math.abs(v.playbackRate - rate) < 0.001) return;
    v.playbackRate = rate;
    this.nudged = rate !== 1;
  }

  private scheduleResync(): void {
    clearTimeout(this.resyncTimer);
    this.resyncTimer = setTimeout(() => this.options.onNeedResync?.(), SYNC.resyncDelayMs);
  }

  // ── video element lifecycle ─────────────────────────────────────────────────

  private ensureVideo(): HTMLVideoElement | null {
    const found = this.find();
    if (found === this.video) return this.video;
    this.detach();
    if (found) this.attach(found);
    return this.video;
  }

  private attach(v: HTMLVideoElement): void {
    this.video = v;
    const on = (type: string, fn: () => void) => {
      v.addEventListener(type, fn);
      this.bound.push([type, fn]);
    };
    on('play', () => this.onLocal('play'));
    on('pause', () => this.onLocal('pause'));
    on('seeked', () => this.onLocal('seeked'));
    on('ended', () => this.onLocal('ended'));
    on('loadedmetadata', () => {
      this.anchor = null;
      const hadPending = this.pending !== null;
      this.flush();
      if (!hadPending) this.scheduleResync(); // player (re)loaded and nothing is waiting: where is the room?
    });
    on('emptied', () => {
      this.anchor = null;
    });
  }

  private detach(): void {
    const v = this.video;
    if (v) for (const [type, fn] of this.bound) v.removeEventListener(type, fn);
    this.bound = [];
    this.video = null;
  }
}
