/**
 * Taking pictures and recording clips: the self-timer, the shutter, the recorder and getting the result saved.
 * All the rules live in the plain modules (countdown, recorder, capture, pipeline); this hook just wires them to React state.
 */
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { captureFilename, capturePhoto, type FramePlan } from '@/features/camera/capture';
import { type Countdown, createCountdown, type TimerSeconds } from '@/features/camera/countdown';
import { type Capture, captureId, isQuotaError } from '@/features/camera/gallery';
import { startPipeline } from '@/features/camera/pipeline';
import { type ClipRecorder, canRecord, createClipRecorder, MAX_RECORD_MS, type StopReason } from '@/features/camera/recorder';
import { stopStream } from '@/features/camera/useCameraStream';
import { downloadBlob } from '@/lib/download';
import { playShutter, playTick } from '@/lib/sound';
import { notify } from '@/lib/toast';

export type CaptureMode = 'photo' | 'video';

export type RecordingState = { elapsedMs: number; bytes: number; paused: boolean };

type Params = {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** The camera is live and showing a picture. */
  live: boolean;
  /** The current look (crop, mirror, filter, sliders), read at the moment of capture. */
  getPlan: () => FramePlan;
  timer: TimerSeconds;
  mic: boolean;
  /** Sounds are on (Settings → Sounds) and so is the camera's own switch. */
  sound: boolean;
  /** Called when the person said yes to the microphone but it wasn't available: the clip is recorded without sound. */
  onMicUnavailable: () => void;
  save: (capture: Capture) => Promise<void>;
  announce: (message: string) => void;
};

type ActiveRecording = { recorder: ClipRecorder; stop: () => Promise<void> };

const limitText = (reason: Exclude<StopReason, 'user'>): string =>
  reason === 'time'
    ? `Reached the ${Math.round(MAX_RECORD_MS / 60_000)} minute limit — recording saved`
    : reason === 'size'
      ? 'Reached the size limit — recording saved'
      : 'The recording stopped unexpectedly';

export function useCapture(params: Params) {
  const { videoRef, live } = params;
  const [mode, setMode] = useState<CaptureMode>('photo');
  const [counting, setCounting] = useState<number | null>(null);
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [flashKey, setFlashKey] = useState(0);
  const [saving, setSaving] = useState(false);

  const latest = useRef(params);
  latest.current = params;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const active = useRef<ActiveRecording | null>(null);
  const starting = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Save to the gallery; if that fails (disk full, storage blocked) the picture isn't lost — offer to download it right away. */
  const persist = useCallback(async (capture: Capture) => {
    const { save, announce } = latest.current;
    const noun = capture.kind === 'photo' ? 'Photo' : 'Video';
    if (alive.current) setSaving(true);
    try {
      await save(capture);
      announce(`${noun} saved`);
    } catch (e) {
      announce(`${noun} could not be saved`);
      notify.action(
        isQuotaError(e) ? 'Not enough storage to keep this' : 'Couldn’t save to the gallery',
        'Download',
        () => downloadBlob(captureFilename(capture.kind, capture.mime, new Date(capture.createdAt)), capture.blob),
        'It’s still here — download it before closing the camera.',
      );
    } finally {
      if (alive.current) setSaving(false);
    }
  }, []);

  const snap = useCallback(async () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const { sound, getPlan } = latest.current;
    setFlashKey((k) => k + 1);
    if (sound) playShutter();
    try {
      const photo = await capturePhoto(video, getPlan());
      await persist({
        id: captureId(),
        kind: 'photo',
        blob: photo.blob,
        thumb: photo.thumb,
        mime: photo.blob.type || 'image/jpeg',
        width: photo.width,
        height: photo.height,
        size: photo.blob.size + photo.thumb.size,
        createdAt: Date.now(),
      });
    } catch {
      latest.current.announce('Could not take the photo');
      notify.error('Couldn’t take the photo', 'The camera had no picture yet. Try again in a moment.');
    }
  }, [persist, videoRef]);

  const beginRecording = useCallback(async () => {
    const video = videoRef.current;
    if (!video || active.current || starting.current) return;
    starting.current = true;
    const { mic, onMicUnavailable, getPlan, announce } = latest.current;

    // Sound is asked for only now, only if the mic switch is on — never for photos, never just for opening the studio.
    let audio: MediaStream | null = null;
    if (mic) {
      try {
        audio = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      } catch {
        onMicUnavailable();
        notify.info('Recording without sound', 'The microphone isn’t available, so this clip will have no audio.');
      }
    }
    if (!alive.current || !latest.current.live) {
      stopStream(audio);
      starting.current = false;
      return;
    }

    const pipeline = startPipeline(video, getPlan);
    if (!pipeline || !canRecord()) {
      stopStream(audio);
      starting.current = false;
      notify.error('Can’t record here', 'This browser can’t record video from the camera.');
      return;
    }

    const stream = new MediaStream([...pipeline.stream.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])]);
    let recorder: ClipRecorder;
    try {
      recorder = createClipRecorder(stream, {
        onTick: (elapsedMs, bytes) => {
          if (alive.current) setRecording({ elapsedMs, bytes, paused: false });
        },
        onAutoStop: (reason) => {
          announce(limitText(reason));
          if (reason !== 'error') notify.info(limitText(reason));
        },
      });
    } catch {
      pipeline.stop();
      stopStream(audio);
      starting.current = false;
      notify.error('Couldn’t start recording', 'The browser refused to start the recorder.');
      return;
    }

    const finished = recorder.done.then(async (clip) => {
      let thumb: Blob | null = null;
      try {
        thumb = await pipeline.poster();
      } catch {
        /* a clip without a poster still saves */
      }
      pipeline.stop();
      stopStream(audio);
      active.current = null;
      if (alive.current) setRecording(null);
      if (clip.blob.size === 0) {
        announce('Nothing was recorded');
        return;
      }
      await persist({
        id: captureId(),
        kind: 'video',
        blob: clip.blob,
        thumb: thumb ?? new Blob([], { type: 'image/jpeg' }),
        mime: clip.mimeType,
        width: pipeline.width,
        height: pipeline.height,
        size: clip.blob.size + (thumb?.size ?? 0),
        durationMs: clip.durationMs,
        createdAt: Date.now(),
      });
    });

    active.current = {
      recorder,
      stop: () => {
        recorder.stop();
        return finished;
      },
    };
    starting.current = false;
    if (alive.current) setRecording({ elapsedMs: 0, bytes: 0, paused: false });
    announce(audio ? 'Recording started' : 'Recording started, without sound');
  }, [persist, videoRef]);

  /** Stop the recording (if any) and resolve once the clip is saved. */
  const stopRecording = useCallback(async () => {
    await active.current?.stop();
  }, []);

  // The self-timer. What happens when it reaches zero is decided by the mode at that moment.
  const countdown = useRef<Countdown | null>(null);
  const timerKind = useRef<CaptureMode>('photo');
  useEffect(() => {
    const c = createCountdown({
      onTick: (n) => {
        if (alive.current) setCounting(n);
        if (n !== null && latest.current.sound) playTick();
        if (n !== null) latest.current.announce(String(n));
      },
      onDone: () => {
        if (timerKind.current === 'photo') void snap();
        else void beginRecording();
      },
    });
    countdown.current = c;
    return () => {
      c.cancel();
      countdown.current = null;
    };
  }, [snap, beginRecording]);

  const cancelCountdown = useCallback((): boolean => {
    const was = countdown.current?.cancel() ?? false;
    if (was) latest.current.announce('Timer cancelled');
    return was;
  }, []);

  /** The big button: start the timer / take the photo / start or stop the recording / cancel a running timer. */
  const shutter = useCallback(() => {
    if (!latest.current.live) return;
    if (countdown.current?.remaining != null) {
      cancelCountdown();
      return;
    }
    if (modeRef.current === 'video') {
      if (active.current) {
        void stopRecording();
        return;
      }
      if (latest.current.timer > 0) {
        timerKind.current = 'video';
        latest.current.announce(`Recording starts in ${latest.current.timer} seconds`);
        countdown.current?.start(latest.current.timer);
      } else void beginRecording();
      return;
    }
    if (latest.current.timer > 0) {
      timerKind.current = 'photo';
      latest.current.announce(`Photo in ${latest.current.timer} seconds`);
      countdown.current?.start(latest.current.timer);
    } else void snap();
  }, [beginRecording, cancelCountdown, snap, stopRecording]);

  // While a recording runs, a hidden tab draws no frames — pause rather than record a frozen picture.
  const isRecording = recording !== null;
  useEffect(() => {
    if (!isRecording) return;
    const onVisibility = () => {
      const a = active.current;
      if (!a) return;
      if (document.hidden) {
        a.recorder.pause();
        setRecording((r) => (r ? { ...r, paused: true } : r));
      } else {
        a.recorder.resume();
        setRecording((r) => (r ? { ...r, paused: false } : r));
        latest.current.announce('Recording resumed');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [isRecording]);

  // The camera went away (unplugged, tab released it): a clip in progress is finished and kept.
  useEffect(() => {
    if (!live && active.current) void stopRecording();
    if (!live) cancelCountdown();
  }, [live, stopRecording, cancelCountdown]);

  // Closed or unmounted mid-recording: finish the clip (it saves on its own) so nothing keeps the camera or microphone.
  useEffect(
    () => () => {
      active.current?.recorder.stop();
    },
    [],
  );

  const changeMode = useCallback(
    (next: CaptureMode) => {
      if (active.current) return; // not mid-recording
      cancelCountdown();
      setMode(next);
    },
    [cancelCountdown],
  );

  return useMemo(
    () => ({ mode, setMode: changeMode, counting, recording, flashKey, saving, shutter, cancelCountdown, stopRecording }),
    [mode, changeMode, counting, recording, flashKey, saving, shutter, cancelCountdown, stopRecording],
  );
}
