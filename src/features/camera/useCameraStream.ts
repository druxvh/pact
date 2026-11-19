/**
 * The live camera, as a hook: starts only while `enabled`, and stops every track the moment it isn't (closed, unmounted, the tab was
 * hidden for a while, or a restart). A `generation` counter makes a slow `getUserMedia` that resolves after all that stop its own
 * tracks instead of leaving the camera light on.
 */
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
  availableResolutions,
  type CapabilityRange,
  decideStart,
  isFrontFacing,
  type OpenResult,
  openCamera,
  type ResolutionId,
  toCameraError,
  zoomRange,
} from '@/features/camera/constraints';
import { type CameraError, endedError, unsupportedError } from '@/features/camera/errors';

export type StreamStatus =
  | { phase: 'idle' }
  /** First time: waiting for the person to press "Allow camera" (we don't surprise them with a browser prompt). */
  | { phase: 'explain' }
  | { phase: 'starting' }
  | { phase: 'live' }
  /** Stopped to save power after the tab was hidden for a while; restarts by itself when it's back. */
  | { phase: 'paused' }
  | { phase: 'error'; error: CameraError };

export type CameraInfo = {
  width: number;
  height: number;
  label: string;
  deviceId: string | null;
  front: boolean;
  zoom: { min: number; max: number; step: number } | null;
  zoomValue: number;
  resolutions: ResolutionId[];
};

export type CameraDevice = { deviceId: string; label: string };

/** How long the tab may stay hidden before the camera is released (the light goes off; it comes back by itself). */
export const HIDDEN_RELEASE_MS = 30_000;

export const stopStream = (stream: MediaStream | null | undefined): void => {
  for (const t of stream?.getTracks() ?? []) {
    try {
      t.stop();
    } catch {
      /* already stopped */
    }
  }
};

type Caps = { width?: CapabilityRange; height?: CapabilityRange; zoom?: CapabilityRange };

export function readInfo(track: MediaStreamTrack): CameraInfo {
  const s = (track.getSettings?.() ?? {}) as MediaTrackSettings & { zoom?: number };
  const caps = (typeof track.getCapabilities === 'function' ? track.getCapabilities() : null) as Caps | null;
  const zoom = zoomRange(caps);
  return {
    width: s.width ?? 0,
    height: s.height ?? 0,
    label: track.label,
    deviceId: s.deviceId ?? null,
    front: isFrontFacing(s, track.label),
    zoom,
    zoomValue: typeof s.zoom === 'number' ? s.zoom : (zoom?.min ?? 1),
    resolutions: availableResolutions(caps),
  };
}

const mediaDevices = (): MediaDevices | undefined => (typeof navigator === 'undefined' ? undefined : navigator.mediaDevices);

async function queryPermission(): Promise<{ state: PermissionState | 'unknown'; status: PermissionStatus | null }> {
  try {
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return { state: status.state, status };
  } catch {
    return { state: 'unknown', status: null };
  }
}

async function listCameras(): Promise<CameraDevice[]> {
  try {
    const all = (await mediaDevices()?.enumerateDevices()) ?? [];
    return all.filter((d) => d.kind === 'videoinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  } catch {
    return [];
  }
}

type Options = {
  enabled: boolean;
  deviceId: string | null;
  resolution: ResolutionId;
  /** Asked when the tab has been hidden a while: `true` keeps the camera on (a recording is running). */
  keepAlive: () => boolean;
  allowedBefore: boolean;
  /** The first successful start: remember that this person said yes. */
  onGranted: () => void;
  /** The chosen camera or resolution wasn't available and a fallback was used. */
  onFallback: (what: NonNullable<OpenResult['fellBack']>) => void;
};

export type CameraStream = {
  status: StreamStatus;
  info: CameraInfo | null;
  devices: CameraDevice[];
  videoRef: RefObject<HTMLVideoElement | null>;
  /** (Re)start now — "Allow camera", "Try again". */
  start: () => void;
  setZoom: (value: number) => void;
};

export function useCameraStream(opts: Options): CameraStream {
  const { enabled, deviceId, resolution } = opts;
  const [status, setStatus] = useState<StreamStatus>({ phase: 'idle' });
  const [info, setInfo] = useState<CameraInfo | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [armed, setArmed] = useState(false);
  const [epoch, setEpoch] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const latest = useRef(opts);
  latest.current = opts;
  const phaseRef = useRef(status.phase);
  phaseRef.current = status.phase;

  /** Stop everything and invalidate any start still in flight. */
  const release = useCallback(() => {
    generation.current += 1;
    stopStream(streamRef.current);
    streamRef.current = null;
    const v = videoRef.current;
    if (v) v.srcObject = null;
    setInfo(null);
  }, []);

  const refreshDevices = useCallback(async () => {
    const list = await listCameras();
    setDevices(list);
  }, []);

  // Decide what to do when the studio opens; stop it all when it closes.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let watching: PermissionStatus | null = null;
    // Fixed in Settings while this is open → start by itself. Only from a waiting/failed screen: a camera that is already
    // starting or live must not be restarted by a permission event (that would loop if a browser fired one per open).
    const onPermissionChange = () => {
      const phase = phaseRef.current;
      if (watching?.state === 'granted' && (phase === 'explain' || phase === 'error')) {
        setArmed(true);
        setEpoch((e) => e + 1);
      }
    };
    void queryPermission().then(({ state, status: permission }) => {
      if (cancelled) return;
      if (!mediaDevices()?.getUserMedia) {
        setStatus({ phase: 'error', error: unsupportedError() });
        return;
      }
      watching = permission;
      permission?.addEventListener?.('change', onPermissionChange);
      const decision = decideStart(state, latest.current.allowedBefore);
      if (decision === 'start') setArmed(true);
      else if (decision === 'denied') setStatus({ phase: 'error', error: { kind: 'denied', message: 'Permission denied' } });
      else setStatus({ phase: 'explain' });
    });
    return () => {
      cancelled = true;
      watching?.removeEventListener?.('change', onPermissionChange);
      release();
      setArmed(false);
      setStatus({ phase: 'idle' });
      setDevices([]);
    };
  }, [enabled, release]);

  // The camera itself: restarts when the camera or resolution changes, or on a manual restart.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `epoch` is the restart trigger, not a value the effect reads
  useEffect(() => {
    if (!enabled || !armed) return;
    const my = ++generation.current;
    stopStream(streamRef.current);
    streamRef.current = null;
    setStatus({ phase: 'starting' });

    openCamera(mediaDevices()?.getUserMedia?.bind(mediaDevices()), { deviceId, resolution })
      .then(({ stream, fellBack }) => {
        if (my !== generation.current) {
          stopStream(stream); // closed (or restarted) while the browser was still asking
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        if (!track) {
          stopStream(stream);
          setStatus({ phase: 'error', error: endedError() });
          return;
        }
        track.addEventListener('ended', () => {
          if (my !== generation.current) return;
          release();
          setStatus({ phase: 'error', error: endedError() });
        });
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          void v.play().catch(() => undefined);
        }
        setInfo(readInfo(track));
        setStatus({ phase: 'live' });
        latest.current.onGranted();
        if (fellBack) latest.current.onFallback(fellBack);
        void refreshDevices();
      })
      .catch((e: unknown) => {
        if (my !== generation.current) return;
        setStatus({ phase: 'error', error: toCameraError(e) });
      });

    return () => {
      // Dependencies changed or the studio closed: this start (and its stream) is done.
      if (generation.current === my) {
        generation.current += 1;
        stopStream(streamRef.current);
        streamRef.current = null;
        const v = videoRef.current;
        if (v) v.srcObject = null;
      }
    };
  }, [enabled, armed, deviceId, resolution, epoch, release, refreshDevices]);

  // Plugging a camera in or out updates the list.
  useEffect(() => {
    const md = mediaDevices();
    if (!enabled || !md?.addEventListener) return;
    const onChange = () => void refreshDevices();
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [enabled, refreshDevices]);

  // Hidden for a while → release the camera (and the indicator light); back → restart.
  const statusPhase = status.phase;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onVisibility = () => {
      if (document.hidden) {
        timer = setTimeout(() => {
          if (latest.current.keepAlive() || !streamRef.current) return;
          release();
          setStatus({ phase: 'paused' });
        }, HIDDEN_RELEASE_MS);
      } else {
        clearTimeout(timer);
        if (statusPhase === 'paused') setEpoch((e) => e + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, release, statusPhase]);

  const start = useCallback(() => {
    setArmed(true);
    setEpoch((e) => e + 1);
  }, []);

  const setZoom = useCallback((value: number) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    void track
      .applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] })
      .then(() => setInfo((i) => (i ? { ...i, zoomValue: value } : i)))
      .catch(() => undefined);
  }, []);

  return { status, info, devices, videoRef, start, setZoom };
}
