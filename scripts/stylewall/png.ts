/**
 * A minimal PNG reader/writer for the plate script (no dependencies): reads 1/2/4/8/16-bit grey, RGB, indexed, grey+alpha and RGBA;
 * writes indexed PNGs at 1/2/4/8 bits with the smallest of the five filter strategies, so the output is byte-for-byte reproducible.
 */
import { constants, deflateSync, inflateSync } from 'node:zlib';

export type Decoded = {
  w: number;
  h: number;
  /** RGBA, 4 bytes per pixel. */
  rgba: Uint8Array;
  /** The raw palette indices when the file was indexed (else null). */
  indices: Uint8Array | null;
  palette: Array<[number, number, number, number]> | null;
};

export function decodePng(buf: Uint8Array): Decoded {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 8;
  let w = 0;
  let h = 0;
  let depth = 0;
  let ct = -1;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  let plte: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  while (p < buf.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(...buf.subarray(p + 4, p + 8));
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = dv.getUint32(p + 8);
      h = dv.getUint32(p + 12);
      depth = body[8] ?? 0;
      ct = body[9] ?? -1;
      interlace = body[12] ?? 0;
    } else if (type === 'PLTE') plte = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (interlace) throw new Error('interlaced PNGs are not supported');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ct];
  if (!channels) throw new Error(`unsupported PNG colour type ${ct}`);
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((w * bitsPerPixel) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i] ?? 0;
      const a = i >= bpp ? (out[row + i - bpp] ?? 0) : 0;
      const b = y > 0 ? (out[row - stride + i] ?? 0) : 0;
      const c = y > 0 && i >= bpp ? (out[row - stride + i - bpp] ?? 0) : 0;
      let v = x;
      if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else if (f !== 0) throw new Error(`bad PNG filter ${f}`);
      out[row + i] = v & 255;
    }
  }
  const sample = (y: number, idx: number): number => {
    // idx-th sample of row y, whatever the bit depth
    const bit = idx * depth;
    const byte = out[y * stride + (bit >> 3)] ?? 0;
    if (depth === 8) return byte;
    if (depth === 16) return byte; // high byte only
    const shift = 8 - depth - (bit & 7);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  const rgba = new Uint8Array(w * h * 4);
  const indices = ct === 3 ? new Uint8Array(w * h) : null;
  const palette: Array<[number, number, number, number]> | null = ct === 3 && plte ? [] : null;
  if (palette && plte) for (let i = 0; i < plte.length / 3; i++) palette.push([plte[i * 3] ?? 0, plte[i * 3 + 1] ?? 0, plte[i * 3 + 2] ?? 0, trns?.[i] ?? 255]);
  const scale = depth < 8 && ct !== 3 ? 255 / ((1 << depth) - 1) : 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (ct === 3) {
        const i = sample(y, x);
        if (indices) indices[y * w + x] = i;
        const c = palette?.[i] ?? [0, 0, 0, 255];
        rgba[o] = c[0];
        rgba[o + 1] = c[1];
        rgba[o + 2] = c[2];
        rgba[o + 3] = c[3];
      } else if (ct === 0 || ct === 4) {
        const g = Math.round(sample(y, x * channels) * scale);
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = ct === 4 ? sample(y, x * channels + 1) : 255;
      } else {
        rgba[o] = sample(y, x * channels);
        rgba[o + 1] = sample(y, x * channels + 1);
        rgba[o + 2] = sample(y, x * channels + 2);
        rgba[o + 3] = ct === 6 ? sample(y, x * channels + 3) : 255;
      }
    }
  }
  return { w, h, rgba, indices, palette };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 255] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

function filterRow(f: number, cur: Uint8Array, prev: Uint8Array | null, bpp: number): Uint8Array {
  const out = new Uint8Array(cur.length + 1);
  out[0] = f;
  for (let i = 0; i < cur.length; i++) {
    const x = cur[i] ?? 0;
    const a = i >= bpp ? (cur[i - bpp] ?? 0) : 0;
    const b = prev ? (prev[i] ?? 0) : 0;
    const c = prev && i >= bpp ? (prev[i - bpp] ?? 0) : 0;
    let pr = 0;
    if (f === 1) pr = a;
    else if (f === 2) pr = b;
    else if (f === 3) pr = (a + b) >> 1;
    else if (f === 4) {
      const pa = Math.abs(b - c);
      const pb = Math.abs(a - c);
      const pc = Math.abs(a + b - 2 * c);
      pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[i + 1] = (x - pr) & 255;
  }
  return out;
}

/** Encode palette indices (values < 2^depth) as an indexed PNG. `palette` is RGB(A) per entry. Deterministic. */
export function encodeIndexed(w: number, h: number, indices: Uint8Array, palette: Array<[number, number, number, number?]>, depth: 1 | 2 | 4 | 8): Uint8Array {
  const stride = Math.ceil((w * depth) / 8);
  const rows: Uint8Array[] = [];
  for (let y = 0; y < h; y++) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < w; x++) {
      const v = indices[y * w + x] ?? 0;
      const bit = x * depth;
      row[bit >> 3] = (row[bit >> 3] ?? 0) | (v << (8 - depth - (bit & 7)));
    }
    rows.push(row);
  }
  let best: Uint8Array | null = null;
  for (const strat of [0, 1, 2, 3, 4, -1]) {
    const parts: Uint8Array[] = [];
    for (let y = 0; y < h; y++) {
      const cur = rows[y] as Uint8Array;
      const prev = y > 0 ? (rows[y - 1] as Uint8Array) : null;
      if (strat >= 0) parts.push(filterRow(strat, cur, prev, 1));
      else {
        let bestRow: Uint8Array | null = null;
        let bestSum = Number.POSITIVE_INFINITY;
        for (let f = 0; f <= 4; f++) {
          const r = filterRow(f, cur, prev, 1);
          let sum = 0;
          for (let i = 1; i < r.length; i++) sum += Math.abs(((r[i] as number) << 24) >> 24);
          if (sum < bestSum) (bestSum = sum), (bestRow = r);
        }
        parts.push(bestRow as Uint8Array);
      }
    }
    const z = deflateSync(Buffer.concat(parts), { level: 9, memLevel: 9, strategy: constants.Z_DEFAULT_STRATEGY });
    if (!best || z.length < best.length) best = z;
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = depth;
  ihdr[9] = 3;
  const plte = new Uint8Array(palette.length * 3);
  palette.forEach((c, i) => plte.set([c[0], c[1], c[2]], i * 3));
  const alphas = palette.map((c) => c[3] ?? 255);
  const hasAlpha = alphas.some((a) => a !== 255);
  const parts: Uint8Array[] = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('PLTE', plte)];
  if (hasAlpha) parts.push(chunk('tRNS', new Uint8Array(alphas)));
  parts.push(chunk('IDAT', best as Uint8Array), chunk('IEND', new Uint8Array(0)));
  return Buffer.concat(parts);
}

/** Encode RGBA (8-bit) — only for the review contact sheets that stay out of the repo. */
export function encodeRgba(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const stride = w * 4;
  const parts: Uint8Array[] = [];
  for (let y = 0; y < h; y++) parts.push(filterRow(0, rgba.subarray(y * stride, (y + 1) * stride), null, 4));
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(parts), { level: 9 })), chunk('IEND', new Uint8Array(0))]);
}
