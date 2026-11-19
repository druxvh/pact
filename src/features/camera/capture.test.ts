import { describe, expect, it, vi } from 'vitest';
import { type Ctx2D, captureFilename, drawFrame, extensionFor, type FramePlan, planFrame } from '@/features/camera/capture';
import { NEUTRAL_ADJUST } from '@/features/camera/filters';
import { createFrameLoop } from '@/features/camera/pipeline';

const plan = (over: Partial<FramePlan> = {}): FramePlan => ({ aspect: 'original', mirror: false, filter: 'none', adjust: NEUTRAL_ADJUST, ...over });

/** A context that records what was done to it. */
function fakeCtx(native: boolean) {
  const calls: unknown[][] = [];
  let filter = 'none';
  const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
  const ctx = {
    drawImage: (...a: unknown[]) => calls.push(['drawImage', filter, ...a]),
    translate: (...a: unknown[]) => calls.push(['translate', ...a]),
    scale: (...a: unknown[]) => calls.push(['scale', ...a]),
    setTransform: (...a: unknown[]) => calls.push(['setTransform', ...a]),
    getImageData: () => ({ data: pixels }) as ImageData,
    putImageData: (...a: unknown[]) => calls.push(['putImageData', ...a]),
    get filter() {
      return filter;
    },
    set filter(v: string) {
      filter = v;
    },
  };
  void native;
  return { ctx: ctx as unknown as Ctx2D, calls, pixels, filterNow: () => filter };
}

describe('planFrame', () => {
  it('keeps the frame for Original, with no filter', () => {
    const f = planFrame(1280, 720, plan());
    expect(f).toMatchObject({ width: 1280, height: 720, mirror: false, css: 'none', ops: [] });
    expect(f.rect).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
  });

  it('crops to the chosen shape and sizes the output to the crop', () => {
    const f = planFrame(1280, 720, plan({ aspect: '1:1' }));
    expect(f.rect).toEqual({ sx: 280, sy: 0, sw: 720, sh: 720 });
    expect([f.width, f.height]).toEqual([720, 720]);
  });

  it('carries the mirror flag and the filter, with the sliders on top', () => {
    const f = planFrame(1280, 720, plan({ mirror: true, filter: 'mono', adjust: { brightness: 110, contrast: 100 } }));
    expect(f.mirror).toBe(true);
    expect(f.css).toBe('grayscale(1) contrast(1.08) brightness(1.1)');
  });

  it('scales a huge source down to the longest edge allowed', () => {
    const f = planFrame(3840, 2160, plan(), 1920);
    expect([f.width, f.height]).toEqual([1920, 1080]);
    expect(f.rect.sw).toBe(3840);
  });
});

describe('drawFrame', () => {
  const source = {} as CanvasImageSource;

  it('draws the crop into the output, un-mirrored, with a clean transform', () => {
    const { ctx, calls } = fakeCtx(true);
    drawFrame(ctx, source, planFrame(1280, 720, plan({ aspect: '1:1' })), true);
    expect(calls.find((c) => c[0] === 'drawImage')).toEqual(['drawImage', 'none', source, 280, 0, 720, 720, 0, 0, 720, 720]);
    expect(calls.some((c) => c[0] === 'translate')).toBe(false);
    expect(calls.at(-1)).toEqual(['setTransform', 1, 0, 0, 1, 0, 0]);
  });

  it('mirrors by flipping horizontally around the output width', () => {
    const { ctx, calls } = fakeCtx(true);
    drawFrame(ctx, source, planFrame(1280, 720, plan({ mirror: true })), true);
    const names = calls.map((c) => c[0]);
    expect(names.indexOf('translate')).toBeLessThan(names.indexOf('drawImage'));
    expect(calls.find((c) => c[0] === 'translate')).toEqual(['translate', 1280, 0]);
    expect(calls.find((c) => c[0] === 'scale')).toEqual(['scale', -1, 1]);
  });

  it('with a native filter, sets ctx.filter for the draw and clears it after', () => {
    const { ctx, calls, filterNow } = fakeCtx(true);
    drawFrame(ctx, source, planFrame(1280, 720, plan({ filter: 'noir' })), true);
    expect(calls.find((c) => c[0] === 'drawImage')?.[1]).toBe('grayscale(1) contrast(1.45) brightness(0.9)');
    expect(filterNow()).toBe('none');
    expect(calls.some((c) => c[0] === 'putImageData')).toBe(false);
  });

  it('without native filters, it does the colour maths on the pixels afterwards', () => {
    const { ctx, calls, pixels } = fakeCtx(false);
    drawFrame(ctx, source, planFrame(2, 1, plan({ filter: 'mono' })), false);
    expect(calls.find((c) => c[0] === 'drawImage')?.[1]).toBe('none');
    expect(calls.some((c) => c[0] === 'putImageData')).toBe(true);
    // red and green both become grey
    expect(pixels[0]).toBe(pixels[1]);
    expect(pixels[1]).toBe(pixels[2]);
    expect(pixels[4]).toBe(pixels[5]);
  });

  it('does nothing extra for "None" on either path', () => {
    for (const native of [true, false]) {
      const { ctx, calls } = fakeCtx(native);
      drawFrame(ctx, source, planFrame(640, 480, plan()), native);
      expect(calls.some((c) => c[0] === 'putImageData')).toBe(false);
    }
  });
});

describe('file names', () => {
  it('are time-stamped, sort by time and use the right extension', () => {
    const at = new Date(2026, 10, 17, 14, 5, 3);
    expect(captureFilename('photo', 'image/jpeg', at)).toBe('pact-photo-2026-11-17-14-05-03.jpg');
    expect(captureFilename('video', 'video/webm;codecs=vp9,opus', at)).toBe('pact-video-2026-11-17-14-05-03.webm');
    expect(captureFilename('video', 'video/mp4', at)).toBe('pact-video-2026-11-17-14-05-03.mp4');
  });

  it('extensionFor is forgiving', () => {
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('IMAGE/JPEG')).toBe('jpg');
    expect(extensionFor('video/x-unknown')).toBe('webm');
    expect(extensionFor('')).toBe('bin');
  });
});

describe('createFrameLoop', () => {
  it('draws once per frame the video reports and stops when asked', () => {
    let pending: (() => void) | null = null;
    const cancelled: number[] = [];
    const video = {
      videoWidth: 1280,
      videoHeight: 720,
      requestVideoFrameCallback: (cb: () => void) => {
        pending = cb;
        return 7;
      },
      cancelVideoFrameCallback: (id: number) => {
        cancelled.push(id);
        pending = null;
      },
    };
    const draw = vi.fn();
    const stop = createFrameLoop(video, draw);
    expect(draw).not.toHaveBeenCalled();
    (pending as (() => void) | null)?.();
    (pending as (() => void) | null)?.();
    expect(draw).toHaveBeenCalledTimes(2);
    stop();
    expect(cancelled).toEqual([7]);
    (pending as (() => void) | null)?.();
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it('falls back to animation frames when the video has no frame callback', () => {
    let pending: (() => void) | null = null;
    const raf = {
      request: (cb: () => void) => {
        pending = cb;
        return 3;
      },
      cancel: vi.fn(() => {
        pending = null;
      }),
    };
    const draw = vi.fn();
    const stop = createFrameLoop({ videoWidth: 1, videoHeight: 1 }, draw, raf);
    (pending as (() => void) | null)?.();
    expect(draw).toHaveBeenCalledTimes(1);
    stop();
    expect(raf.cancel).toHaveBeenCalledWith(3);
  });
});
