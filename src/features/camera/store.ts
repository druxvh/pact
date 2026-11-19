/**
 * The camera's remembered choices (key `pact-camera`).
 *
 * Device-specific on purpose — a camera id means nothing on another computer — so this is neither in backups nor kept across
 * an account switch (see `NOT_BACKED_UP` and `PERSONAL_KEYS`). The photo/video choice and the brightness/contrast sliders are
 * not remembered: the studio always opens ready to take a photo, with the picture as the camera sees it.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { isResolutionId, type ResolutionId } from '@/features/camera/constraints';
import { isTimerSeconds, type TimerSeconds } from '@/features/camera/countdown';
import { type FilterId, isFilterId } from '@/features/camera/filters';
import { type AspectId, isAspectId } from '@/features/camera/geometry';
import { syncAcrossTabs } from '@/lib/persist';

export const CAMERA_KEY = 'pact-camera';

export type CameraPrefs = {
  /** `null` = follow the camera: mirrored for a front camera, not for a back one. Once toggled, the choice sticks. */
  mirror: boolean | null;
  grid: boolean;
  timer: TimerSeconds;
  aspect: AspectId;
  filter: FilterId;
  /** The chosen camera (`null` = the browser's default). */
  deviceId: string | null;
  resolution: ResolutionId;
  /** Record with the microphone. Sound is only requested when a recording actually starts. */
  mic: boolean;
  /** The shutter click (also needs Settings → Sounds on). */
  shutterSound: boolean;
  /** This person has allowed the camera before, so the "Allow camera" explainer is skipped. */
  allowedBefore: boolean;
};

type CameraState = CameraPrefs & {
  set: <K extends keyof CameraPrefs>(key: K, value: CameraPrefs[K]) => void;
};

export const DEFAULT_PREFS: CameraPrefs = {
  mirror: null,
  grid: false,
  timer: 0,
  aspect: 'original',
  filter: 'none',
  deviceId: null,
  resolution: 'auto',
  mic: true,
  shutterSound: true,
  allowedBefore: false,
};

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Whatever is in storage (older build, hand edit) is coerced, never trusted. */
export function coercePrefs(persisted: unknown): CameraPrefs {
  const p = (persisted && typeof persisted === 'object' ? persisted : {}) as Partial<Record<keyof CameraPrefs, unknown>>;
  const d = DEFAULT_PREFS;
  return {
    mirror: typeof p.mirror === 'boolean' ? p.mirror : null,
    grid: bool(p.grid, d.grid),
    timer: isTimerSeconds(p.timer) ? p.timer : d.timer,
    aspect: isAspectId(p.aspect) ? p.aspect : d.aspect,
    filter: isFilterId(p.filter) ? p.filter : d.filter,
    deviceId: typeof p.deviceId === 'string' && p.deviceId.length > 0 && p.deviceId.length <= 512 ? p.deviceId : null,
    resolution: isResolutionId(p.resolution) ? p.resolution : d.resolution,
    mic: bool(p.mic, d.mic),
    shutterSound: bool(p.shutterSound, d.shutterSound),
    allowedBefore: bool(p.allowedBefore, d.allowedBefore),
  };
}

export const useCameraStore = create<CameraState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFS,
      set: (key, value) => set({ [key]: value } as Partial<CameraPrefs>),
    }),
    {
      name: CAMERA_KEY,
      version: 1,
      partialize: (s): CameraPrefs => coercePrefs(s),
      merge: (persisted, current) => ({ ...current, ...coercePrefs(persisted) }),
    },
  ),
);

syncAcrossTabs(CAMERA_KEY, useCameraStore);

/** Mirror for this camera: the saved choice, else "yes for a front camera". */
export const effectiveMirror = (pref: boolean | null, front: boolean): boolean => (pref === null ? front : pref);
