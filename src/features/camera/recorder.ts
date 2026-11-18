/**
 * A thin, testable wrapper around MediaRecorder: picks the best container, keeps an honest clock (pauses don't count), and stops
 * by itself at the time or size cap so a forgotten recording can't fill the disk.
 */

/** Best first. Opus only makes sense when there is an audio track. */
const WITH_AUDIO = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=h264,opus', 'video/webm', 'video/mp4'];
const NO_AUDIO = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm;codecs=h264', 'video/webm', 'video/mp4'];

/** The first supported container, or `''` to let the browser choose. */
export function pickMimeType(hasAudio: boolean, isSupported: (type: string) => boolean = defaultIsSupported): string {
  for (const t of hasAudio ? WITH_AUDIO : NO_AUDIO) {
    try {
      if (isSupported(t)) return t;
    } catch {
      /* a throwing probe is "no" */
    }
  }
  return '';
}

function defaultIsSupported(type: string): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(type);
}

export const canRecord = (): boolean => typeof MediaRecorder !== 'undefined';

/** Hard limits for one clip. */
export const MAX_RECORD_MS = 5 * 60_000;
export const MAX_RECORD_BYTES = 200 * 1024 * 1024;
/** About 19 MB a minute: sharp at 720p and well inside the size cap for the full 5 minutes. */
export const VIDEO_BITS_PER_SECOND = 2_500_000;
export const AUDIO_BITS_PER_SECOND = 128_000;

export type StopReason = 'user' | 'time' | 'size' | 'error';
export type Clip = { blob: Blob; durationMs: number; mimeType: string; reason: StopReason };

export type RecorderOptions = {
  mimeType?: string;
  maxMs?: number;
  maxBytes?: number;
  /** Called a few times a second with the running clock and bytes so far. */
  onTick?: (elapsedMs: number, bytes: number) => void;
  /** Called when a limit (or an error) ends the recording by itself, just before `done` resolves. */
  onAutoStop?: (reason: Exclude<StopReason, 'user'>) => void;
  now?: () => number;
};

export type ClipRecorder = {
  /** Resolves once, with the finished clip, however the recording ended. */
  done: Promise<Clip>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  readonly paused: boolean;
  elapsed: () => number;
};

const TICK_MS = 250;

export function createClipRecorder(stream: MediaStream, opts: RecorderOptions = {}): ClipRecorder {
  const now = opts.now ?? (() => Date.now());
  const maxMs = opts.maxMs ?? MAX_RECORD_MS;
  const maxBytes = opts.maxBytes ?? MAX_RECORD_BYTES;
  const hasAudio = stream.getAudioTracks().length > 0;
  const mimeType = opts.mimeType ?? pickMimeType(hasAudio);

  const options: MediaRecorderOptions = { videoBitsPerSecond: VIDEO_BITS_PER_SECOND };
  if (hasAudio) options.audioBitsPerSecond = AUDIO_BITS_PER_SECOND;
  if (mimeType) options.mimeType = mimeType;
  const rec = new MediaRecorder(stream, options);

  const chunks: Blob[] = [];
  let bytes = 0;
  let reason: StopReason = 'user';
  let finished = false;
  let activeSince: number | null = now();
  let accumulated = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const elapsed = () => accumulated + (activeSince === null ? 0 : now() - activeSince);

  let resolveDone!: (clip: Clip) => void;
  const done = new Promise<Clip>((resolve) => {
    resolveDone = resolve;
  });

  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    const type = rec.mimeType || mimeType || 'video/webm';
    resolveDone({ blob: new Blob(chunks, { type }), durationMs: Math.min(elapsed(), maxMs), mimeType: type, reason });
  };

  const requestStop = (why: StopReason) => {
    if (finished || rec.state === 'inactive') return;
    reason = why;
    // Freeze the clock now: `onstop` fires a moment later, after the last chunk is flushed.
    if (activeSince !== null) {
      accumulated += now() - activeSince;
      activeSince = null;
    }
    if (why !== 'user') opts.onAutoStop?.(why);
    try {
      rec.stop();
    } catch {
      finish();
    }
  };

  rec.ondataavailable = (e: BlobEvent) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
      bytes += e.data.size;
      if (bytes >= maxBytes) requestStop('size');
    }
  };
  rec.onstop = finish;
  rec.onerror = () => requestStop('error');

  // A timeslice makes the browser hand over data as it goes, which is what lets us watch the size.
  rec.start(1000);
  timer = setInterval(() => {
    if (finished) return;
    const t = elapsed();
    opts.onTick?.(Math.min(t, maxMs), bytes);
    if (t >= maxMs) requestStop('time');
  }, TICK_MS);

  return {
    done,
    stop: () => requestStop('user'),
    pause: () => {
      if (finished || rec.state !== 'recording') return;
      try {
        rec.pause();
      } catch {
        return;
      }
      if (activeSince !== null) {
        accumulated += now() - activeSince;
        activeSince = null;
      }
    },
    resume: () => {
      if (finished || rec.state !== 'paused') return;
      try {
        rec.resume();
      } catch {
        return;
      }
      activeSince = now();
    },
    get paused() {
      return rec.state === 'paused';
    },
    elapsed,
  };
}

/** `0:07`, `12:34` — the running clock next to the REC dot. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
