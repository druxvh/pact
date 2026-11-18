import { describe, expect, it, vi } from 'vitest';
import {
  availableResolutions,
  buildVideoConstraints,
  decideStart,
  type GetUserMedia,
  isFrontFacing,
  isResolutionId,
  openCamera,
  zoomRange,
} from '@/features/camera/constraints';
import type { CameraError } from '@/features/camera/errors';

const dom = (name: string, message = '') => new DOMException(message, name);
const fakeStream = { id: 'stream' } as unknown as MediaStream;

describe('buildVideoConstraints', () => {
  it('asks for about 720p and the front camera by default', () => {
    expect(buildVideoConstraints({ deviceId: null, resolution: 'auto' })).toEqual({ width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' });
  });

  it('a chosen camera is required exactly, and facing mode is dropped', () => {
    const c = buildVideoConstraints({ deviceId: 'abc', resolution: 'auto' });
    expect(c.deviceId).toEqual({ exact: 'abc' });
    expect(c.facingMode).toBeUndefined();
  });

  it('720p and 1080p set a floor as well as a target', () => {
    expect(buildVideoConstraints({ deviceId: null, resolution: '1080p' })).toMatchObject({
      width: { ideal: 1920, min: 1920 },
      height: { ideal: 1080, min: 1080 },
    });
    expect(buildVideoConstraints({ deviceId: null, resolution: '720p' })).toMatchObject({
      width: { ideal: 1280, min: 1280 },
      height: { ideal: 720, min: 720 },
    });
  });

  it('knows its resolution ids', () => {
    expect(isResolutionId('auto')).toBe(true);
    expect(isResolutionId('4k')).toBe(false);
  });
});

describe('availableResolutions', () => {
  it('offers everything until the camera has said what it can do', () => {
    expect(availableResolutions(null)).toEqual(['auto', '720p', '1080p']);
  });

  it('hides 1080p for a 720p camera, and 720p for a VGA one', () => {
    expect(availableResolutions({ width: { max: 1280 }, height: { max: 720 } })).toEqual(['auto', '720p']);
    expect(availableResolutions({ width: { max: 640 }, height: { max: 480 } })).toEqual(['auto']);
    expect(availableResolutions({ width: { max: 3840 }, height: { max: 2160 } })).toEqual(['auto', '720p', '1080p']);
  });
});

describe('zoomRange', () => {
  it('is null unless the camera really zooms', () => {
    expect(zoomRange(null)).toBeNull();
    expect(zoomRange({})).toBeNull();
    expect(zoomRange({ zoom: { min: 1, max: 1 } })).toBeNull();
    expect(zoomRange({ zoom: { max: 4 } })).toBeNull();
  });

  it('gives the range and a step', () => {
    expect(zoomRange({ zoom: { min: 1, max: 4, step: 0.5 } })).toEqual({ min: 1, max: 4, step: 0.5 });
    expect(zoomRange({ zoom: { min: 100, max: 500 } })).toEqual({ min: 100, max: 500, step: 4 });
  });
});

describe('isFrontFacing', () => {
  it('trusts facingMode when there is one', () => {
    expect(isFrontFacing({ facingMode: 'user' }, 'Back camera')).toBe(true);
    expect(isFrontFacing({ facingMode: 'environment' })).toBe(false);
  });

  it('treats a desktop webcam (no facingMode) as front, unless the name says otherwise', () => {
    expect(isFrontFacing({}, 'FaceTime HD Camera')).toBe(true);
    expect(isFrontFacing(undefined)).toBe(true);
    expect(isFrontFacing({}, 'camera2 0, facing back')).toBe(false);
    expect(isFrontFacing({}, 'Rear Camera')).toBe(false);
  });
});

describe('openCamera', () => {
  it('opens with the request as given', async () => {
    const gum = vi.fn<GetUserMedia>(async () => fakeStream);
    const r = await openCamera(gum, { deviceId: 'cam1', resolution: '1080p' });
    expect(r).toEqual({ stream: fakeStream, fellBack: null });
    expect(gum).toHaveBeenCalledTimes(1);
    expect(gum.mock.calls[0]?.[0]).toMatchObject({ audio: false, video: { deviceId: { exact: 'cam1' } } });
  });

  it('never asks for audio just by opening the camera', async () => {
    const gum = vi.fn<GetUserMedia>(async () => fakeStream);
    await openCamera(gum, { deviceId: null, resolution: 'auto' });
    expect(gum.mock.calls[0]?.[0].audio).toBe(false);
  });

  it('steps back to Auto when the camera cannot do the resolution', async () => {
    const gum = vi.fn<GetUserMedia>(async (c) => {
      if ((c.video as MediaTrackConstraints).width && ((c.video as MediaTrackConstraints).width as { min?: number }).min)
        throw dom('OverconstrainedError', 'width');
      return fakeStream;
    });
    const r = await openCamera(gum, { deviceId: null, resolution: '1080p' });
    expect(r.fellBack).toBe('resolution');
    expect(gum).toHaveBeenCalledTimes(2);
  });

  it('steps back to the default camera when the chosen one is gone', async () => {
    const gum = vi.fn<GetUserMedia>(async (c) => {
      if ((c.video as MediaTrackConstraints).deviceId) throw dom('OverconstrainedError', 'deviceId');
      return fakeStream;
    });
    const r = await openCamera(gum, { deviceId: 'gone', resolution: 'auto' });
    expect(r.fellBack).toBe('device');
    expect(gum).toHaveBeenCalledTimes(2);
  });

  it('a missing device and a high resolution fall back through every step', async () => {
    const gum = vi.fn<GetUserMedia>(async (c) => {
      const v = c.video as MediaTrackConstraints;
      if (v.deviceId) throw dom('NotFoundError');
      return fakeStream;
    });
    const r = await openCamera(gum, { deviceId: 'gone', resolution: '1080p' });
    expect(r.fellBack).toBe('device');
    expect(gum).toHaveBeenCalledTimes(3);
  });

  it('does not retry (or hide) a permission problem', async () => {
    const gum = vi.fn<GetUserMedia>(async () => {
      throw dom('NotAllowedError', 'Permission denied');
    });
    await expect(openCamera(gum, { deviceId: 'cam', resolution: '1080p' })).rejects.toMatchObject({ kind: 'denied' });
    expect(gum).toHaveBeenCalledTimes(1);
  });

  it('a busy camera is reported as busy straight away', async () => {
    const gum = vi.fn<GetUserMedia>(async () => {
      throw dom('NotReadableError');
    });
    await expect(openCamera(gum, { deviceId: null, resolution: 'auto' })).rejects.toMatchObject({ kind: 'busy' });
  });

  it('no camera at all is "no camera"', async () => {
    const gum = vi.fn<GetUserMedia>(async () => {
      throw dom('NotFoundError');
    });
    await expect(openCamera(gum, { deviceId: null, resolution: 'auto' })).rejects.toMatchObject({ kind: 'no-camera' });
  });

  it('no getUserMedia at all is "unsupported"', async () => {
    const err = (await openCamera(undefined, { deviceId: null, resolution: 'auto' }).catch((e: CameraError) => e)) as CameraError;
    expect(err.kind).toBe('unsupported');
  });
});

describe('decideStart', () => {
  it('starts straight away when the browser has already said yes', () => {
    expect(decideStart('granted', false)).toBe('start');
    expect(decideStart('granted', true)).toBe('start');
  });

  it('goes to the "blocked" help when the browser has said no', () => {
    expect(decideStart('denied', true)).toBe('denied');
  });

  it('explains first when it would be the first prompt', () => {
    expect(decideStart('prompt', false)).toBe('explain');
    expect(decideStart('prompt', true)).toBe('explain');
    expect(decideStart('unknown', false)).toBe('explain');
  });

  it('without a Permissions API, someone who said yes before just gets the camera', () => {
    expect(decideStart('unknown', true)).toBe('start');
  });
});
