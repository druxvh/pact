export type RemoteSyncCommand = {
  playing?: boolean;
  mediaTime: number;
  serverTime?: number;
  videoId?: string | null;
};

export type LocalMediaEvent = {
  ev: 'play' | 'pause' | 'seek' | 'ended' | 'state';
  mediaTime: number;
  playing: boolean;
  videoId: string | null;
};

export type SyncEngineOptions = {
  onLocalEvent: (event: LocalMediaEvent) => void;
};

export interface SyncEngineControls {
  suspend: () => void;
  resume: () => void;
}

import { parseYouTubeId } from './protocol';

const ECHO_LOCK_MS = 250;
const DRIFT_HARD_SEEK_S = 2.0;
const DRIFT_SOFT_S = 0.3;
const RATE_SPEED_UP = 1.05;
const RATE_SLOW_DOWN = 0.95;
const DRIFT_TICK_MS = 2000;
const STATE_HEARTBEAT_MS = 2000;

export function getYouTubeVideoId(): string | null {
  return parseYouTubeId(location.href);
}

export class SyncEngine {
  private video: HTMLVideoElement | null = null;
  private isRemoteAction = false;
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private anchor = { mediaTime: 0, at: 0, playing: false };
  private observer: MutationObserver | null = null;
  private driftTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private bound: Array<[HTMLVideoElement, string, EventListener]> = [];
  private disposed = false;
  private lastVideoSrc: string | null = null;

  constructor(private readonly options: SyncEngineOptions) {}

  start(): void {
    this.tryAttach();
    this.observer = new MutationObserver(() => this.tryAttach());
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
    this.driftTimer = setInterval(() => this.correctDrift(), DRIFT_TICK_MS);
    this.heartbeatTimer = setInterval(() => this.emitState(), STATE_HEARTBEAT_MS);
  }

  dispose(): void {
    this.disposed = true;
    this.clearLockTimer();
    this.observer?.disconnect();
    this.observer = null;
    if (this.driftTimer) clearInterval(this.driftTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.driftTimer = null;
    this.heartbeatTimer = null;
    this.detach();
  }

  isLocked(): boolean {
    return this.isRemoteAction;
  }

  applyRemote(cmd: RemoteSyncCommand): void {
    const video = this.video ?? this.tryAttach();
    if (!video) return;
    if (cmd.videoId) {
      const localId = getYouTubeVideoId();
      if (localId && cmd.videoId && localId !== cmd.videoId) return;
    }
    this.withLock(() => {
      const target = Math.max(0, cmd.mediaTime);
      if (Number.isFinite(target) && Math.abs(video.currentTime - target) > 0.05) {
        try {
          video.currentTime = target;
        } catch {
          return;
        }
      }
      video.playbackRate = 1.0;
      if (typeof cmd.playing === 'boolean') {
        if (cmd.playing) {
          void video.play().catch(() => {});
        } else {
          video.pause();
        }
      }
    });
    this.anchor = {
      mediaTime: Math.max(0, cmd.mediaTime),
      at: Date.now(),
      playing: cmd.playing ?? !video.paused,
    };
  }

  private tryAttach(): HTMLVideoElement | null {
    if (this.disposed) return this.video;
    const found = document.querySelector('video');
    if (found) {
      const src = found.src || found.currentSrc;
      if (found !== this.video || (this.lastVideoSrc !== src && src)) {
        this.lastVideoSrc = src;
        this.detach();
        this.video = found;
        this.attach(found);
        this.anchor = { mediaTime: 0, at: Date.now(), playing: false };
        this.emitState();
      }
    } else if (this.video !== null) {
      // No video element found (YouTube may have removed it)
      this.lastVideoSrc = null;
      this.detach();
      this.video = null;
    }
    return this.video;
  }

  private attach(video: HTMLVideoElement): void {
    const handlers: Array<[string, EventListener]> = [
      ['play', () => this.handleLocal('play')],
      ['pause', () => this.handleLocal('pause')],
      ['seeking', () => this.handleLocal('seek')],
      ['ended', () => this.handleLocal('ended')],
      ['loadstart', () => {
        this.lastVideoSrc = null;
        this.anchor = { mediaTime: 0, at: Date.now(), playing: false };
      }],
    ];
    for (const [type, fn] of handlers) {
      video.addEventListener(type, fn);
      this.bound.push([video, type, fn]);
    }
  }

  private detach(): void {
    for (const [video, type, fn] of this.bound) video.removeEventListener(type, fn);
    this.bound = [];
    this.video = null;
  }

  private handleLocal(ev: LocalMediaEvent['ev']): void {
    if (this.isRemoteAction) return;
    const video = this.video;
    if (!video) return;
    const playing = ev === 'play' ? true : ev === 'pause' || ev === 'ended' ? false : !video.paused;
    const mediaTime = ev === 'ended' ? video.duration || video.currentTime : video.currentTime;
    this.anchor = { mediaTime, at: Date.now(), playing };
    this.options.onLocalEvent({ ev, mediaTime, playing, videoId: getYouTubeVideoId() });
  }

  private emitState(): void {
    const video = this.video;
    if (!video || this.isRemoteAction) return;
    this.options.onLocalEvent({
      ev: 'state',
      mediaTime: video.currentTime,
      playing: !video.paused && !video.ended,
      videoId: getYouTubeVideoId(),
    });
  }

  private correctDrift(): void {
    const video = this.video;
    if (!video || this.isRemoteAction || !this.anchor.playing) return;
    if (video.paused || video.ended) return;
    const elapsed = (Date.now() - this.anchor.at) / 1000;
    const expected = this.anchor.mediaTime + elapsed;
    const drift = video.currentTime - expected;
    const magnitude = Math.abs(drift);
    if (magnitude > DRIFT_HARD_SEEK_S) {
      this.withLock(() => {
        video.currentTime = Math.max(0, expected);
        video.playbackRate = 1.0;
      });
      return;
    }
    if (magnitude > DRIFT_SOFT_S) {
      const rate = drift > 0 ? RATE_SLOW_DOWN : RATE_SPEED_UP;
      if (Math.abs(video.playbackRate - rate) > 0.001) {
        this.withLock(() => {
          video.playbackRate = rate;
        });
      }
      return;
    }
    if (Math.abs(video.playbackRate - 1.0) > 0.001) {
      this.withLock(() => {
        video.playbackRate = 1.0;
      });
    }
  }

  private withLock(fn: () => void): void {
    this.isRemoteAction = true;
    this.clearLockTimer();
    try {
      fn();
    } finally {
      this.lockTimer = setTimeout(() => {
        this.isRemoteAction = false;
        this.lockTimer = null;
      }, ECHO_LOCK_MS);
    }
  }

  private clearLockTimer(): void {
    if (this.lockTimer) {
      clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }
  }

  suspend(): void {
    this.clearLockTimer();
    this.isRemoteAction = false;
    this.driftTimer && clearInterval(this.driftTimer);
    this.driftTimer = null;
    this.heartbeatTimer && clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.observer?.disconnect();
    this.observer = null;
    this.detach();
  }

  resume(): void {
    this.anchor = { mediaTime: 0, at: Date.now(), playing: false };
    this.isRemoteAction = false;
    this.tryAttach();
    this.observer = new MutationObserver(() => this.tryAttach());
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
    this.driftTimer = setInterval(() => this.correctDrift(), DRIFT_TICK_MS);
    this.heartbeatTimer = setInterval(() => this.emitState(), STATE_HEARTBEAT_MS);
  }
}
