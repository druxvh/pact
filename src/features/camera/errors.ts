/**
 * Camera errors, in plain words.
 *
 * `getUserMedia` fails with a DOMException whose `name` (and sometimes `message`) says why. People don't care about the name — they
 * need to know what to DO — so every failure is mapped to one of a few kinds, each with copy and a recovery path.
 */
export type CameraErrorKind =
  /** The person (or an enterprise policy) blocked the camera for this extension. Fix: browser site settings. */
  | 'denied'
  /** The browser is allowed, but the operating system blocks it (macOS / Windows privacy settings). */
  | 'denied-system'
  /** The permission prompt was closed without an answer. Fix: ask again. */
  | 'dismissed'
  | 'no-camera'
  /** Another app (or tab) has the camera, or the hardware failed to start. */
  | 'busy'
  /** No `navigator.mediaDevices` at all: an insecure page, or a browser without camera support. */
  | 'unsupported'
  /** The stream was live and then stopped by itself: unplugged, another app took it, the system slept. */
  | 'ended'
  | 'unknown';

export type CameraError = { kind: CameraErrorKind; message: string };

export type ErrorCopy = {
  title: string;
  body: string;
  /** Label for the primary button; `null` = nothing to retry (the fix lives outside the page). */
  action: string | null;
};

const nameOf = (e: unknown): string => (e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '');
const messageOf = (e: unknown): string => (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '');

/** Map whatever `getUserMedia` (or the code around it) threw to a `CameraError`. */
export function mapCameraError(e: unknown): CameraError {
  const name = nameOf(e);
  const message = messageOf(e);
  const lower = message.toLowerCase();
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      // Chrome words the three cases differently in the message; the name is the same for all of them.
      if (lower.includes('dismissed')) return { kind: 'dismissed', message };
      if (lower.includes('by system') || lower.includes('operating system')) return { kind: 'denied-system', message };
      return { kind: 'denied', message };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { kind: 'no-camera', message };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return { kind: 'busy', message };
    case 'SecurityError':
      return { kind: 'unsupported', message };
    // A bad constraint set is something we recover from before it reaches here; if it still does, it is "the camera can't do that".
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return { kind: 'unknown', message };
    case 'TypeError':
      return { kind: 'unsupported', message };
    default:
      return { kind: 'unknown', message };
  }
}

export const unsupportedError = (): CameraError => ({ kind: 'unsupported', message: 'navigator.mediaDevices is not available' });
export const endedError = (): CameraError => ({ kind: 'ended', message: 'The camera stream ended' });

export const ERROR_COPY: Record<CameraErrorKind, ErrorCopy> = {
  denied: {
    title: 'Camera access is blocked',
    body: 'pact can’t use your camera because it’s blocked for this extension. Allow it in the browser’s settings, then come back and try again.',
    action: 'Try again',
  },
  'denied-system': {
    title: 'Your system is blocking the camera',
    body: 'The browser is allowed to use the camera, but your operating system isn’t letting it through. Open your system’s privacy settings, allow camera access for your browser, then try again.',
    action: 'Try again',
  },
  dismissed: {
    title: 'Allow the camera to continue',
    body: 'The permission prompt was closed without an answer. pact only turns the camera on while this window is open, and nothing is uploaded.',
    action: 'Allow camera',
  },
  'no-camera': {
    title: 'No camera found',
    body: 'Plug in a webcam or check that it’s switched on, then try again. If you just connected it, give it a second.',
    action: 'Look again',
  },
  busy: {
    title: 'The camera is busy',
    body: 'Another app or browser tab is using it, or it didn’t start. Close the other app (a video call, for example), then try again.',
    action: 'Try again',
  },
  unsupported: {
    title: 'Camera isn’t available here',
    body: 'This page can’t reach a camera. That happens in browsers without camera support, or on a page that isn’t secure.',
    action: null,
  },
  ended: {
    title: 'The camera stopped',
    body: 'The video stopped unexpectedly. It may have been unplugged, taken over by another app, or interrupted while your computer slept.',
    action: 'Restart camera',
  },
  unknown: {
    title: 'Couldn’t start the camera',
    body: 'Something went wrong while starting the camera.',
    action: 'Try again',
  },
};

/** Where to re-enable a blocked camera. A page can't open `chrome://` links, so these are shown as text to copy. */
export const CAMERA_SETTINGS_URL = 'chrome://settings/content/camera';

/** The settings page for just this extension (Chromium), e.g. `chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2F<id>`. */
export function siteSettingsUrl(extensionId: string | null | undefined): string | null {
  if (!extensionId || !/^[a-p]{32}$/.test(extensionId)) return null;
  return `chrome://settings/content/siteDetails?site=${encodeURIComponent(`chrome-extension://${extensionId}`)}`;
}

/** Errors the person can fix in browser settings (so the "how to re-enable" help is shown). */
export const needsSettingsHelp = (kind: CameraErrorKind): boolean => kind === 'denied';
