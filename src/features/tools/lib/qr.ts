import { encode } from 'uqr';

export type Ecc = 'L' | 'M' | 'Q' | 'H';
export type ModuleStyle = 'square' | 'dots';

export type QrOptions = { ecc: Ecc; style: ModuleStyle; fg: string; bg: string; margin: number };

/** Generate the boolean module matrix for `text`. */
export function qrMatrix(text: string, ecc: Ecc): boolean[][] {
  return encode(text, { ecc, border: 0 }).data;
}

/** Wi-Fi share string understood by phone cameras. */
export function wifiPayload(ssid: string, password: string, security: 'WPA' | 'WEP' | 'nopass', hidden: boolean): string {
  const esc = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');
  return `WIFI:T:${security};S:${esc(ssid)};${security === 'nopass' ? '' : `P:${esc(password)};`}${hidden ? 'H:true;' : ''};`;
}

/** True for modules inside the three 7×7 finder "eyes" (scanners lock onto these). */
function inFinder(x: number, y: number, n: number): boolean {
  return (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
}

/** Vector output — crisp at any size, and the exact thing we preview. */
export function qrSvg(matrix: boolean[][], opts: QrOptions, size = 512): string {
  const n = matrix.length;
  const total = n + opts.margin * 2;
  const rects: string[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!matrix[y]?.[x]) continue;
      const cx = x + opts.margin;
      const cy = y + opts.margin;
      rects.push(
        opts.style === 'dots' && !inFinder(x, y, n)
          ? `<circle cx="${cx + 0.5}" cy="${cy + 0.5}" r="0.46"/>`
          : `<rect x="${cx}" y="${cy}" width="1.02" height="1.02"${opts.style === 'dots' ? ' rx="0.3"' : ''}/>`,
      );
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="${opts.style === 'dots' ? 'auto' : 'crispEdges'}"><rect width="${total}" height="${total}" fill="${opts.bg}"/><g fill="${opts.fg}">${rects.join('')}</g></svg>`;
}

/** Raster output for PNG download / clipboard. */
export async function qrPng(matrix: boolean[][], opts: QrOptions, size = 1024): Promise<Blob> {
  const n = matrix.length;
  const total = n + opts.margin * 2;
  const cell = Math.max(1, Math.floor(size / total));
  const px = cell * total;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = opts.fg;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!matrix[y]?.[x]) continue;
      const X = (x + opts.margin) * cell;
      const Y = (y + opts.margin) * cell;
      if (opts.style === 'dots' && !inFinder(x, y, n)) {
        ctx.beginPath();
        ctx.arc(X + cell / 2, Y + cell / 2, cell * 0.46, 0, Math.PI * 2);
        ctx.fill();
      } else if (opts.style === 'dots') {
        ctx.beginPath();
        ctx.roundRect(X, Y, cell + 0.5, cell + 0.5, cell * 0.3);
        ctx.fill();
      } else {
        ctx.fillRect(X, Y, cell + 0.5, cell + 0.5);
      }
    }
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not render PNG');
  return blob;
}
