/**
 * What to ask the browser for, and how to back off when the camera can't do it.
 *
 * `getUserMedia` is passed in (not read from `navigator`) so the fallback chain can be tested without a camera.
 */
import { type CameraError, mapCameraError, unsupportedError } from '@/features/camera/errors';

export type ResolutionId = 'auto' | '720p' | '1080p';

export const RESOLUTIONS: ReadonlyArray<{ id: ResolutionId; label: string; width: number; height: number }> = [
  { id: 'auto', label: 'Auto', width: 1280, height: 720 },
  { id: '720p', label: '720p', width: 1280, height: 720 },
  { id: '1080p', label: '1080p', width: 1920, height: 1080 },
];

export const isResolutionId = (v: unknown): v is ResolutionId => v === 'auto' || v === '720p' || v === '1080p';

export type VideoRequest = { deviceId: string | null; resolution: ResolutionId };

/**
 * The video constraints for a request. Auto = "about 720p, whatever the camera prefers"; 720p / 1080p additionally set a floor, so
 * the browser picks a mode of at least that size — or fails, which `openCamera` turns into a graceful step back to Auto.
 */
export function buildVideoConstraints({ deviceId, resolution }: VideoRequest): MediaTrackConstraints {
  const res = RESOLUTIONS.find((r) => r.id === resolution) ?? RESOLUTIONS[0];
  const base: MediaTrackConstraints = { width: { ideal: res?.width ?? 1280 }, height: { ideal: res?.height ?? 720 } };
  if (resolution !== 'auto' && res) {
    base.width = { ideal: res.width, min: res.width };
    base.height = { ideal: res.height, min: res.height };
  }
  if (deviceId) base.deviceId = { exact: deviceId };
  else base.facingMode = 'user';
  return base;
}

export type CapabilityRange = { min?: number; max?: number; step?: number };

/** Resolutions the camera has said it can do (all of them until it has said anything). */
export function availableResolutions(caps: { width?: CapabilityRange; height?: CapabilityRange } | null): ResolutionId[] {
  const out: ResolutionId[] = ['auto'];
  for (const r of RESOLUTIONS) {
    if (r.id === 'auto') continue;
    if (!caps) {
      out.push(r.id);
      continue;
    }
    const wOk = caps.width?.max === undefined || caps.width.max >= r.width;
    const hOk = caps.height?.max === undefined || caps.height.max >= r.height;
    if (wOk && hOk) out.push(r.id);
  }
  return out;
}

/** A zoom range the track really supports (a slider needs `max > min`). */
export function zoomRange(caps: { zoom?: CapabilityRange } | null | undefined): { min: number; max: number; step: number } | null {
  const z = caps?.zoom;
  if (!z || typeof z.min !== 'number' || typeof z.max !== 'number' || !(z.max > z.min)) return null;
  const step = typeof z.step === 'number' && z.step > 0 ? z.step : (z.max - z.min) / 100;
  return { min: z.min, max: z.max, step };
}

/** `facingMode` is often missing on desktop webcams — those (and anything not labelled as a rear camera) are "front". */
export function isFrontFacing(settings: { facingMode?: string } | null | undefined, label = ''): boolean {
  const facing = settings?.facingMode;
  if (facing === 'user') return true;
  if (facing === 'environment' || facing === 'left' || facing === 'right') return false;
  return !/\b(back|rear|environment)\b/i.test(label);
}

export type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

export type OpenResult = {
  stream: MediaStream;
  /** What we had to give up to get a picture: the chosen camera was gone, or it couldn't do the chosen resolution. */
  fellBack: 'device' | 'resolution' | null;
};

const isConstraintFailure = (e: unknown): boolean => {
  const n = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
  return n === 'OverconstrainedError' || n === 'ConstraintNotSatisfiedError' || n === 'NotFoundError' || n === 'DevicesNotFoundError';
};

/**
 * Open the camera, stepping back when the request is too specific: chosen camera + resolution → same camera at Auto → the default
 * camera. Anything that isn't "it can't do that" (blocked, busy, no hardware at all…) is thrown straight away as a `CameraError`.
 */
export async function openCamera(gum: GetUserMedia | undefined, request: VideoRequest): Promise<OpenResult> {
  if (!gum) throw unsupportedError();
  const attempts: Array<{ request: VideoRequest; fellBack: OpenResult['fellBack'] }> = [{ request, fellBack: null }];
  if (request.resolution !== 'auto') attempts.push({ request: { ...request, resolution: 'auto' }, fellBack: 'resolution' });
  if (request.deviceId) attempts.push({ request: { deviceId: null, resolution: 'auto' }, fellBack: 'device' });

  let last: unknown;
  for (const attempt of attempts) {
    try {
      const stream = await gum({ video: buildVideoConstraints(attempt.request), audio: false });
      return { stream, fellBack: attempt.fellBack };
    } catch (e) {
      last = e;
      if (!isConstraintFailure(e)) throw toCameraError(e);
    }
  }
  throw toCameraError(last);
}

/** Anything thrown becomes a `CameraError` (already-mapped ones pass through). */
export function toCameraError(e: unknown): CameraError {
  if (e && typeof e === 'object' && 'kind' in e && 'message' in e) return e as CameraError;
  return mapCameraError(e);
}

/** What to do when the camera view opens, given the browser's permission state and whether this person has said yes before. */
export type StartDecision = 'start' | 'explain' | 'denied';

export function decideStart(permission: PermissionState | 'unknown', grantedBefore: boolean): StartDecision {
  if (permission === 'granted') return 'start';
  if (permission === 'denied') return 'denied';
  // 'prompt' (or no Permissions API): a first-timer gets the explainer, someone who allowed it before just gets the camera.
  return grantedBefore && permission === 'unknown' ? 'start' : 'explain';
}
