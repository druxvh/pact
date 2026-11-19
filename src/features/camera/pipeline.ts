/**
 * The video recorder's picture source.
 *
 * MediaRecorder records exactly what a stream carries, so to bake the mirror, crop and filter into a clip the preview's frames are
 * redrawn onto a canvas (`drawFrame`, the same code a photo uses) and the recorder is fed `canvas.captureStream()`. Mirror, filter and
 * brightness/contrast stay live while recording; the crop is fixed when the clip starts (a stream can't change size half-way).
 *
 * Frames are pulled with `requestVideoFrameCallback` where it exists (one draw per real camera frame), else `requestAnimationFrame`.
 * Neither runs while the tab is hidden, so the studio pauses the recorder then instead of recording a frozen picture.
 */
import { drawFrame, type FramePlan, getContext, makeThumb, planFrame } from '@/features/camera/capture';

export type Pipeline = {
  /** Video from the canvas; add an audio track to this before recording. */
  stream: MediaStream;
  width: number;
  height: number;
  /** A JPEG of what the clip currently looks like (the gallery poster). */
  poster: () => Promise<Blob>;
  stop: () => void;
};

export const PIPELINE_FPS = 30;
/** A 4K webcam is recorded at 1080p: smaller files, smoother encoding. */
export const PIPELINE_MAX_EDGE = 1920;

type FrameSource = Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight'> & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/** Calls `cb` once per new picture until stopped. Exported for tests (the scheduler is injectable). */
export function createFrameLoop(
  video: FrameSource,
  cb: () => void,
  raf: { request: (cb: () => void) => number; cancel: (id: number) => void } = {
    request: (f) => requestAnimationFrame(f),
    cancel: (id) => cancelAnimationFrame(id),
  },
): () => void {
  let stopped = false;
  let id = 0;
  const useVideoCb = typeof video.requestVideoFrameCallback === 'function';
  const tick = () => {
    if (stopped) return;
    cb();
    schedule();
  };
  const schedule = () => {
    if (useVideoCb) id = (video.requestVideoFrameCallback as (cb: () => void) => number)(tick);
    else id = raf.request(tick);
  };
  schedule();
  return () => {
    stopped = true;
    if (useVideoCb) video.cancelVideoFrameCallback?.(id);
    else raf.cancel(id);
  };
}

/** Start redrawing `video` onto a canvas as `getPlan()` says. Returns `null` when there is no picture yet or no canvas. */
export function startPipeline(video: HTMLVideoElement, getPlan: () => FramePlan): Pipeline | null {
  const first = planFrame(video.videoWidth, video.videoHeight, getPlan(), PIPELINE_MAX_EDGE);
  if (first.width === 0 || first.height === 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = first.width;
  canvas.height = first.height;
  const got = getContext(canvas);
  if (!got || typeof canvas.captureStream !== 'function') return null;
  const { ctx, native } = got;

  // The output size can't change mid-clip: the crop is fixed now, while mirror / filter / adjust follow the sliders.
  const aspect = getPlan().aspect;
  const draw = () => {
    const live = planFrame(video.videoWidth, video.videoHeight, { ...getPlan(), aspect }, PIPELINE_MAX_EDGE);
    drawFrame(ctx, video, { ...live, rect: first.rect, width: first.width, height: first.height }, native);
  };

  draw();
  const stopLoop = createFrameLoop(video, draw);
  const stream = canvas.captureStream(PIPELINE_FPS);

  return {
    stream,
    width: first.width,
    height: first.height,
    poster: () => makeThumb(canvas, first.width, first.height),
    stop: () => {
      stopLoop();
      for (const t of stream.getTracks()) t.stop();
    },
  };
}
