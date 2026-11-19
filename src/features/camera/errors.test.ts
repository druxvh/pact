import { describe, expect, it } from 'vitest';
import {
  CAMERA_SETTINGS_URL,
  type CameraErrorKind,
  ERROR_COPY,
  endedError,
  mapCameraError,
  needsSettingsHelp,
  siteSettingsUrl,
  unsupportedError,
} from '@/features/camera/errors';

const dom = (name: string, message = '') => new DOMException(message, name);

describe('mapCameraError', () => {
  it.each([
    ['NotAllowedError', 'Permission denied', 'denied'],
    ['PermissionDeniedError', '', 'denied'],
    ['NotAllowedError', 'Permission dismissed', 'dismissed'],
    ['NotAllowedError', 'Permission denied by system', 'denied-system'],
    ['NotFoundError', 'Requested device not found', 'no-camera'],
    ['DevicesNotFoundError', '', 'no-camera'],
    ['NotReadableError', 'Could not start video source', 'busy'],
    ['TrackStartError', '', 'busy'],
    ['AbortError', 'Starting videoinput failed', 'busy'],
    ['SecurityError', '', 'unsupported'],
    ['TypeError', 'undefined is not a function', 'unsupported'],
    ['OverconstrainedError', 'width', 'unknown'],
    ['SomethingElse', 'huh', 'unknown'],
  ])('%s "%s" → %s', (name, message, kind) => {
    expect(mapCameraError(dom(name, message)).kind).toBe(kind);
  });

  it('keeps the original message, and copes with non-errors', () => {
    expect(mapCameraError(dom('NotFoundError', 'nope')).message).toBe('nope');
    expect(mapCameraError('boom').kind).toBe('unknown');
    expect(mapCameraError(null).kind).toBe('unknown');
    expect(mapCameraError(undefined).message).toBe('');
  });

  it('has ready-made errors for "no mediaDevices" and "the stream ended"', () => {
    expect(unsupportedError().kind).toBe('unsupported');
    expect(endedError().kind).toBe('ended');
  });
});

describe('the copy', () => {
  const kinds: CameraErrorKind[] = ['denied', 'denied-system', 'dismissed', 'no-camera', 'busy', 'unsupported', 'ended', 'unknown'];

  it('every kind says what happened and what to do', () => {
    for (const k of kinds) {
      expect(ERROR_COPY[k].title.length, k).toBeGreaterThan(5);
      expect(ERROR_COPY[k].body.length, k).toBeGreaterThan(20);
    }
  });

  it('only a dead end (no camera support at all) has no retry button', () => {
    for (const k of kinds) expect(ERROR_COPY[k].action === null, k).toBe(k === 'unsupported');
  });

  it('a blocked camera shows how to re-enable it, nothing else does', () => {
    expect(needsSettingsHelp('denied')).toBe(true);
    for (const k of kinds.filter((x) => x !== 'denied')) expect(needsSettingsHelp(k), k).toBe(false);
  });
});

describe('the settings addresses', () => {
  it('has the generic camera settings page as text', () => {
    expect(CAMERA_SETTINGS_URL).toBe('chrome://settings/content/camera');
  });

  it("points at this extension's own page when it knows the id", () => {
    expect(siteSettingsUrl('kkjbfallganmejcadkcdhppaokcnkefp')).toBe(
      'chrome://settings/content/siteDetails?site=chrome-extension%3A%2F%2Fkkjbfallganmejcadkcdhppaokcnkefp',
    );
  });

  it('refuses anything that is not an extension id', () => {
    expect(siteSettingsUrl(null)).toBeNull();
    expect(siteSettingsUrl('')).toBeNull();
    expect(siteSettingsUrl('short')).toBeNull();
    expect(siteSettingsUrl('KKJBFALLGANMEJCADKCDHPPAOKCNKEFP')).toBeNull();
    expect(siteSettingsUrl('kkjbfallganmejcadkcdhppaokcnkefp/../x')).toBeNull();
  });
});
