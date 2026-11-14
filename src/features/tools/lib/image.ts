/** Client-side image compression (Canvas). Nothing is uploaded — it never leaves the browser. */
export type OutputFormat = 'original' | 'jpeg' | 'webp' | 'png';

export type CompressOptions = {
  format: OutputFormat;
  /** 0.1–1 (ignored for PNG, which is lossless) */
  quality: number;
  /** longest side in px; 0 = keep original size */
  maxDimension: number;
  /** if set, keep reducing quality/size until the file is at most this many bytes */
  targetBytes?: number;
};

export type CompressResult = { blob: Blob; width: number; height: number; mime: string; iterations: number };

const MIME: Record<Exclude<OutputFormat, 'original'>, string> = { jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png' };

export function extensionFor(mime: string): string {
  return mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'img';
}

function resolveMime(format: OutputFormat, original: string): string {
  if (format !== 'original') return MIME[format];
  return original === 'image/jpeg' || original === 'image/png' || original === 'image/webp' ? original : MIME.webp;
}

function fit(w: number, h: number, maxDim: number): { w: number; h: number } {
  if (!maxDim || Math.max(w, h) <= maxDim) return { w, h };
  const scale = maxDim / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

async function encode(bitmap: ImageBitmap, w: number, h: number, mime: string, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');
  if (mime === 'image/jpeg') {
    ctx.fillStyle = '#fff'; // JPEG has no alpha — avoid black backgrounds on transparent PNGs
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
  if (!blob) throw new Error('Could not encode the image');
  return blob;
}

export async function compressImage(file: File, opts: CompressOptions): Promise<CompressResult> {
  // 'from-image' applies EXIF rotation so phone photos don't come out sideways.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    // "Auto" on a PNG tries both lossless PNG and lossy WebP and keeps whichever is smaller —
    // flat screenshots win as PNG, photos win as WebP. (A plain "keep PNG" can't shrink a photo.)
    const mimes = opts.format === 'original' && file.type === 'image/png' ? ['image/png', 'image/webp'] : [resolveMime(opts.format, file.type)];

    const attempt = async (mime: string): Promise<CompressResult> => {
      let { w, h } = fit(bitmap.width, bitmap.height, opts.maxDimension);
      let quality = Math.min(1, Math.max(0.1, opts.quality));
      let blob = await encode(bitmap, w, h, mime, quality);
      let iterations = 1;
      if (opts.targetBytes) {
        // Shed quality first (not for PNG), then shrink dimensions, until it fits.
        while (blob.size > opts.targetBytes && iterations < 14) {
          if (mime !== 'image/png' && quality > 0.4) quality = Math.max(0.4, quality - 0.1);
          else {
            w = Math.max(1, Math.round(w * 0.85));
            h = Math.max(1, Math.round(h * 0.85));
          }
          blob = await encode(bitmap, w, h, mime, quality);
          iterations++;
        }
      }
      return { blob, width: w, height: h, mime, iterations };
    };

    const results = await Promise.all(mimes.map(attempt));
    return results.reduce((best, r) => (r.blob.size < best.blob.size ? r : best));
  } finally {
    bitmap.close();
  }
}
