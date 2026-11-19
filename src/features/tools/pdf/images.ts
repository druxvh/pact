/** Getting arbitrary images into a form pdf-lib can embed (JPEG or PNG), upright. Uses canvas, so browser-only. */
import { jpegOrientation } from '@/features/tools/lib/pdf/exif';
import type { ImageInput } from '@/features/tools/lib/pdf/types';

export const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

export type PreparedImage = { name: string; input: ImageInput; width: number; height: number; url: string };

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t encode the image.'))), type, quality));
}

/** Draw a bitmap (optionally turned by 90° steps) and encode it. JPEG gets a white background, PNG keeps transparency. */
async function encode(bitmap: ImageBitmap, turn: number, kind: 'jpg' | 'png'): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const swap = turn % 180 !== 0;
  const w = swap ? bitmap.height : bitmap.width;
  const h = swap ? bitmap.width : bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  if (kind === 'jpg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.translate(w / 2, h / 2);
  ctx.rotate((turn * Math.PI) / 180);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  const blob = await toBlob(canvas, kind === 'jpg' ? 'image/jpeg' : 'image/png', 0.92);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: w, height: h };
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') throw new Error('not a supported image (use JPG, PNG, WebP, GIF…).');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('is over 40 MB.');
  const raw = new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(new Blob([raw.slice().buffer], { type: file.type }), { imageOrientation: 'from-image' }).catch(() => {
    throw new Error('couldn’t be read.');
  });
  try {
    let input: ImageInput;
    let width = bitmap.width;
    let height = bitmap.height;
    if (file.type === 'image/png') input = { bytes: raw, kind: 'png' };
    else if (file.type === 'image/jpeg' && jpegOrientation(raw) === 1) input = { bytes: raw, kind: 'jpg' };
    else {
      // Sideways phone photos (EXIF), WebP, GIF, AVIF…: re-draw upright. `from-image` already applied the EXIF turn.
      const out = await encode(bitmap, 0, file.type === 'image/jpeg' ? 'jpg' : 'png');
      input = { bytes: out.bytes, kind: file.type === 'image/jpeg' ? 'jpg' : 'png' };
      width = out.width;
      height = out.height;
    }
    return {
      name: file.name,
      input,
      width,
      height,
      url: URL.createObjectURL(new Blob([input.bytes.slice().buffer], { type: input.kind === 'png' ? 'image/png' : 'image/jpeg' })),
    };
  } finally {
    bitmap.close();
  }
}

/** Bake a 90°-step rotation into the image data (so the PDF page matches the preview). */
export async function turnImage(img: PreparedImage, turn: number): Promise<ImageInput> {
  if (turn % 360 === 0) return img.input;
  const bitmap = await createImageBitmap(new Blob([img.input.bytes.slice().buffer], { type: img.input.kind === 'png' ? 'image/png' : 'image/jpeg' }));
  try {
    return { kind: img.input.kind, bytes: (await encode(bitmap, ((turn % 360) + 360) % 360, img.input.kind)).bytes };
  } finally {
    bitmap.close();
  }
}
