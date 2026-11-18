/**
 * Turning the live picture into files: one frame → a photo, or a stream of frames → what the video recorder sees.
 *
 * Both go through `drawFrame`, so a photo and a clip get exactly the same crop, mirroring and filter as the preview showed.
 */

import { type Adjust, applyPixelFilter, type FilterId, type FilterOp, opsFor, supportsCtxFilter, toCss } from '@/features/camera/filters';
import { type AspectId, aspectRatio, cropRect, outputSize, type Rect, THUMB_EDGE, thumbSize } from '@/features/camera/geometry';

/** What the person has chosen: the single source of truth for "how should the picture look". */
export type FramePlan = { aspect: AspectId; mirror: boolean; filter: FilterId; adjust: Adjust };

export type Frame = { rect: Rect; width: number; height: number; mirror: boolean; ops: FilterOp[]; css: string };

/** Work out the crop, output size and filter for a source frame of `srcW × srcH`. */
export function planFrame(srcW: number, srcH: number, plan: FramePlan, maxEdge = 4096): Frame {
  const rect = cropRect(srcW, srcH, aspectRatio(plan.aspect));
  const { width, height } = outputSize(rect.sw, rect.sh, maxEdge);
  const ops = opsFor(plan.filter, plan.adjust);
  return { rect, width, height, mirror: plan.mirror, ops, css: toCss(ops) };
}

/** The slice of a 2D context `drawFrame` uses (so tests can pass a recorder). */
export type Ctx2D = Pick<CanvasRenderingContext2D, 'drawImage' | 'getImageData' | 'putImageData' | 'translate' | 'scale' | 'setTransform'> & {
  filter?: string;
};

/**
 * Draw `source` into the context as `frame` describes. `native` = the context honours `ctx.filter` (Chromium); otherwise the
 * colour maths run on the pixels afterwards — slower, identical result.
 */
export function drawFrame(ctx: Ctx2D, source: CanvasImageSource, frame: Frame, native: boolean): void {
  const { rect, width, height } = frame;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (native && frame.ops.length) ctx.filter = frame.css;
  if (frame.mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, width, height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (native) {
    if (frame.ops.length) ctx.filter = 'none';
  } else if (frame.ops.length) {
    const img = ctx.getImageData(0, 0, width, height);
    applyPixelFilter(img.data, frame.ops);
    ctx.putImageData(img, 0, 0);
  }
}

let nativeFilter: boolean | null = null;

/** A 2D context plus whether it has native filters (probed once). `willReadFrequently` only when the slow path will read pixels back. */
export function getContext(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; native: boolean } | null {
  nativeFilter ??= supportsCtxFilter(document.createElement('canvas').getContext('2d'));
  const ctx = canvas.getContext('2d', nativeFilter ? undefined : { willReadFrequently: true });
  return ctx ? { ctx, native: nativeFilter } : null;
}

export const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))), type, quality);
  });

/** A small JPEG of whatever is on `source` (a canvas or a video frame), for the filmstrip. */
export async function makeThumb(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const size = thumbSize(width, height, THUMB_EDGE);
  const c = document.createElement('canvas');
  c.width = size.width;
  c.height = size.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return canvasToBlob(c, 'image/jpeg', 0.72);
}

export type Photo = { blob: Blob; thumb: Blob; width: number; height: number };

/** The most photo quality that is still a sensible file size: a 1080p JPEG at this setting is a few hundred kB. */
export const PHOTO_MIME = 'image/jpeg';
export const PHOTO_QUALITY = 0.92;

/** Grab the current frame of the preview as a photo. */
export async function capturePhoto(video: HTMLVideoElement, plan: FramePlan): Promise<Photo> {
  const frame = planFrame(video.videoWidth, video.videoHeight, plan);
  if (frame.width === 0 || frame.height === 0) throw new Error('The camera has no picture yet');
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const got = getContext(canvas);
  if (!got) throw new Error('Canvas is not available');
  drawFrame(got.ctx, video, frame, got.native);
  const [blob, thumb] = await Promise.all([canvasToBlob(canvas, PHOTO_MIME, PHOTO_QUALITY), makeThumb(canvas, frame.width, frame.height)]);
  return { blob, thumb, width: frame.width, height: frame.height };
}

/** A poster frame for a video clip, from the live preview (the clip itself has no cheap way to get one). */
export const capturePoster = (video: HTMLVideoElement, plan: FramePlan) =>
  capturePhoto(video, plan).then((p) => ({ thumb: p.thumb, width: p.width, height: p.height }));

/** Clipboard images must be PNG in Chromium. */
export async function blobToPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    ctx.drawImage(bitmap, 0, 0);
    return await canvasToBlob(c, 'image/png');
  } finally {
    bitmap.close();
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `pact-photo-2026-11-17-14-05-33.jpg` — sorts by time, no characters a file system dislikes. */
export function captureFilename(kind: 'photo' | 'video', mime: string, at: Date): string {
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
  return `pact-${kind}-${stamp}.${extensionFor(mime)}`;
}

export function extensionFor(mime: string): string {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  switch (base) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
    case 'audio/webm':
      return 'webm';
    default:
      return base.startsWith('video/') ? 'webm' : 'bin';
  }
}
