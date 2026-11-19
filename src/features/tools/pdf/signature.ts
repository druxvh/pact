/** Turning a drawn, typed or uploaded signature into a tidy transparent PNG. The pixel maths is pure so it's tested. */

/** Bounding box of pixels that are visible (alpha above a threshold), or null if the image is empty. */
export function inkBounds(data: Uint8ClampedArray, width: number, height: number, minAlpha = 12): { x: number; y: number; w: number; h: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > minAlpha) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Make a scanned signature's paper white transparent: the lighter a pixel, the more transparent (ink keeps its colour). */
export function whiteToAlpha(data: Uint8ClampedArray, low = 150, high = 235): void {
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
    const keep = lum <= low ? 1 : lum >= high ? 0 : 1 - (lum - low) / (high - low);
    data[i + 3] = Math.round((data[i + 3] ?? 255) * keep);
  }
}

export type Signature = { id: string; png: Uint8Array; url: string /** width / height */; ratio: number };

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/png'));

/** Crop a canvas to its ink (with a little padding) and produce the signature. Returns null if nothing was drawn. */
export async function signatureFromCanvas(source: HTMLCanvasElement, id: string, pad = 6): Promise<Signature | null> {
  const ctx = source.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const box = inkBounds(ctx.getImageData(0, 0, source.width, source.height).data, source.width, source.height);
  if (!box) return null;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const w = Math.min(source.width - x, box.w + pad * 2);
  const h = Math.min(source.height - y, box.h + pad * 2);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')?.drawImage(source, x, y, w, h, 0, 0, w, h);
  const blob = await toBlob(out);
  return { id, png: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob), ratio: w / h };
}

/** A photo or scan of a signature → transparent-background signature (white paper removed). */
export async function signatureFromImage(file: File, id: string): Promise<Signature | null> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bitmap.width * scale));
    c.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    whiteToAlpha(img.data);
    ctx.putImageData(img, 0, 0);
    return signatureFromCanvas(c, id);
  } finally {
    bitmap.close();
  }
}
