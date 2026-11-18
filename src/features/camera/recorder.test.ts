import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIO_BITS_PER_SECOND,
  createClipRecorder,
  formatElapsed,
  MAX_RECORD_BYTES,
  MAX_RECORD_MS,
  pickMimeType,
  VIDEO_BITS_PER_SECOND,
} from '@/features/camera/recorder';

/** Just enough of MediaRecorder: the test decides when data arrives. */
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static supported = new Set<string>();
  static isTypeSupported = (t: string) => FakeRecorder.supported.has(t);
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  started: number | undefined;
  constructor(
    readonly stream: unknown,
    readonly options: MediaRecorderOptions,
  ) {
    this.mimeType = options.mimeType ?? '';
    FakeRecorder.instances.push(this);
  }
  start(timeslice?: number) {
    this.state = 'recording';
    this.started = timeslice;
  }
  stop() {
    if (this.state === 'inactive') throw new Error('InvalidStateError');
    this.state = 'inactive';
    queueMicrotask(() => this.onstop?.());
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  emit(bytes: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
}

const stream = (audio: boolean) => ({ getAudioTracks: () => (audio ? [{}] : []), getVideoTracks: () => [{}] }) as unknown as MediaStream;
const last = () => FakeRecorder.instances.at(-1) as FakeRecorder;

beforeEach(() => {
  FakeRecorder.instances = [];
  FakeRecorder.supported = new Set(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('pickMimeType', () => {
  it('prefers VP9 + Opus, then VP8 + Opus, then plain webm', () => {
    expect(pickMimeType(true, (t) => FakeRecorder.isTypeSupported(t))).toBe('video/webm;codecs=vp9,opus');
    FakeRecorder.supported.delete('video/webm;codecs=vp9,opus');
    expect(pickMimeType(true, (t) => FakeRecorder.isTypeSupported(t))).toBe('video/webm;codecs=vp8,opus');
    FakeRecorder.supported.delete('video/webm;codecs=vp8,opus');
    expect(pickMimeType(true, (t) => FakeRecorder.isTypeSupported(t))).toBe('video/webm');
  });

  it('without audio it does not ask for Opus', () => {
    FakeRecorder.supported = new Set(['video/webm;codecs=vp9', 'video/webm;codecs=vp9,opus']);
    expect(pickMimeType(false, (t) => FakeRecorder.isTypeSupported(t))).toBe('video/webm;codecs=vp9');
  });

  it('falls back to MP4 (Safari), then to "" so the browser chooses', () => {
    expect(pickMimeType(true, (t) => t === 'video/mp4')).toBe('video/mp4');
    expect(pickMimeType(true, () => false)).toBe('');
  });

  it('treats a throwing probe as "not supported"', () => {
    expect(
      pickMimeType(true, () => {
        throw new Error('boom');
      }),
    ).toBe('');
  });

  it('uses the real MediaRecorder.isTypeSupported by default', () => {
    expect(pickMimeType(true)).toBe('video/webm;codecs=vp9,opus');
  });
});

describe('createClipRecorder', () => {
  it('records with a sensible bitrate, the best container and a timeslice', () => {
    createClipRecorder(stream(true));
    const r = last();
    expect(r.options.mimeType).toBe('video/webm;codecs=vp9,opus');
    expect(r.options.videoBitsPerSecond).toBe(VIDEO_BITS_PER_SECOND);
    expect(r.options.audioBitsPerSecond).toBe(AUDIO_BITS_PER_SECOND);
    expect(r.started).toBe(1000);
    expect(r.state).toBe('recording');
  });

  it('asks for no audio bitrate when there is no audio track', () => {
    createClipRecorder(stream(false));
    expect(last().options.audioBitsPerSecond).toBeUndefined();
  });

  it('stop() resolves with everything recorded, the duration and reason "user"', async () => {
    let t = 1000;
    const rec = createClipRecorder(stream(true), { now: () => t });
    last().emit(500);
    last().emit(700);
    t += 4200;
    rec.stop();
    const clip = await rec.done;
    expect(clip.reason).toBe('user');
    expect(clip.blob.size).toBe(1200);
    expect(clip.durationMs).toBe(4200);
    expect(clip.mimeType).toBe('video/webm;codecs=vp9,opus');
  });

  it('reports the running clock', () => {
    const ticks: Array<[number, number]> = [];
    let t = 0;
    createClipRecorder(stream(false), { now: () => t, onTick: (ms, bytes) => ticks.push([ms, bytes]) });
    last().emit(100);
    t += 250;
    vi.advanceTimersByTime(250);
    expect(ticks.at(-1)).toEqual([250, 100]);
  });

  it('pausing stops the clock: paused time is not recording time', async () => {
    let t = 0;
    const rec = createClipRecorder(stream(false), { now: () => t });
    t += 2000;
    rec.pause();
    expect(rec.paused).toBe(true);
    t += 60_000; // tab hidden for a minute
    rec.resume();
    expect(rec.paused).toBe(false);
    t += 1000;
    expect(rec.elapsed()).toBe(3000);
    rec.stop();
    expect((await rec.done).durationMs).toBe(3000);
  });

  it('stops by itself at the size cap and says why', async () => {
    const onAutoStop = vi.fn();
    const rec = createClipRecorder(stream(false), { maxBytes: 1000, onAutoStop });
    last().emit(400);
    expect(onAutoStop).not.toHaveBeenCalled();
    last().emit(700);
    const clip = await rec.done;
    expect(clip.reason).toBe('size');
    expect(clip.blob.size).toBe(1100);
    expect(onAutoStop).toHaveBeenCalledWith('size');
    expect(last().state).toBe('inactive');
  });

  it('stops by itself at the time cap and caps the reported duration', async () => {
    let t = 0;
    const onAutoStop = vi.fn();
    const rec = createClipRecorder(stream(false), { maxMs: 3000, now: () => t, onAutoStop });
    t = 2900;
    vi.advanceTimersByTime(250);
    expect(onAutoStop).not.toHaveBeenCalled();
    t = 3100;
    vi.advanceTimersByTime(250);
    const clip = await rec.done;
    expect(clip.reason).toBe('time');
    expect(clip.durationMs).toBeLessThanOrEqual(3000);
    expect(onAutoStop).toHaveBeenCalledWith('time');
  });

  it('has real-world caps of 5 minutes and 200 MB', () => {
    expect(MAX_RECORD_MS).toBe(300_000);
    expect(MAX_RECORD_BYTES).toBe(200 * 1024 * 1024);
  });

  it('a recorder error ends the clip with reason "error" (and keeps what it has)', async () => {
    const onAutoStop = vi.fn();
    const rec = createClipRecorder(stream(false), { onAutoStop });
    last().emit(50);
    last().onerror?.();
    const clip = await rec.done;
    expect(clip.reason).toBe('error');
    expect(clip.blob.size).toBe(50);
  });

  it('ignores empty chunks, a second stop() and ticks after it finished', async () => {
    const onTick = vi.fn();
    const rec = createClipRecorder(stream(false), { onTick });
    last().emit(0);
    rec.stop();
    rec.stop();
    const clip = await rec.done;
    expect(clip.blob.size).toBe(0);
    onTick.mockClear();
    vi.advanceTimersByTime(2000);
    expect(onTick).not.toHaveBeenCalled();
  });
});

describe('formatElapsed', () => {
  it('shows m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(7_400)).toBe('0:07');
    expect(formatElapsed(83_000)).toBe('1:23');
    expect(formatElapsed(300_000)).toBe('5:00');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});
