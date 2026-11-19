/**
 * A tiny, dependency-free ZIP writer for "download all" (Split PDF). STORE only — no compression, because PDFs are
 * already compressed and a deflate pass would cost time for ~nothing. Every ZIP reader (Finder, Explorer, unzip) opens
 * these. No ZIP64: it refuses archives past 4 GiB or 65 535 files rather than writing a broken one.
 *
 * Layout: for each file a local header + its bytes, then the central directory (one record per file), then the
 * end-of-central-directory record. `zipParts` returns those as separate chunks so a `Blob` can be built from them
 * without ever concatenating hundreds of megabytes into one buffer.
 */

// CRC-32 (IEEE 802.3, the one ZIP uses), slicing-by-8: about 1 GB/s, so checksumming a 150 MB result is a blink.
const TABLE = (() => {
  const t = new Uint32Array(8 * 256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  for (let n = 0; n < 256; n++) {
    let c = t[n] as number;
    for (let k = 1; k < 8; k++) {
      c = (t[c & 0xff] as number) ^ (c >>> 8);
      t[k * 256 + n] = c;
    }
  }
  return t;
})();
const T = (i: number): number => TABLE[i] as number;

/** CRC-32 of `data`. Pass a previous result as `previous` to continue a checksum across chunks. */
export function crc32(data: Uint8Array, previous = 0): number {
  let c = (previous ^ 0xffffffff) >>> 0;
  const len = data.length;
  let i = 0;
  if (len >= 8) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (; i + 8 <= len; i += 8) {
      const one = view.getUint32(i, true) ^ c;
      const two = view.getUint32(i + 4, true);
      c =
        T(7 * 256 + (one & 0xff)) ^
        T(6 * 256 + ((one >>> 8) & 0xff)) ^
        T(5 * 256 + ((one >>> 16) & 0xff)) ^
        T(4 * 256 + (one >>> 24)) ^
        T(3 * 256 + (two & 0xff)) ^
        T(2 * 256 + ((two >>> 8) & 0xff)) ^
        T(256 + ((two >>> 16) & 0xff)) ^
        T(two >>> 24);
    }
  }
  for (; i < len; i++) c = T((c ^ (data[i] as number)) & 0xff) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array; modified?: Date };

const MAX_ENTRIES = 0xffff;
const MAX_SIZE = 0xffffffff;
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const UTF8_NAMES = 0x0800;

/** File names in a ZIP are paths: no folders, nothing Windows would reject, never empty. */
export function zipSafeName(name: string): string {
  return (
    Array.from(name)
      .map((ch) => (/[\\/:*?"<>|]/.test(ch) || ch.charCodeAt(0) < 32 ? '_' : ch))
      .join('')
      .trim() || 'file'
  );
}

/** MS-DOS date and time, which is what ZIP stores (2-second resolution, 1980 onwards). */
export function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Make names unique (case-insensitively, as Windows and macOS treat them) by adding -2, -3… before the extension. */
function uniqueNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const name = zipSafeName(raw);
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let candidate = name;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** The archive as consecutive chunks (concatenate them, or hand them to `new Blob`). */
export function zipParts(entries: readonly ZipEntry[]): Uint8Array[] {
  if (entries.length > MAX_ENTRIES) throw new Error(`A ZIP holds at most ${MAX_ENTRIES} files.`);
  const encoder = new TextEncoder();
  const names = uniqueNames(entries.map((e) => e.name));
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [i, entry] of entries.entries()) {
    const name = encoder.encode(names[i]);
    const { time, date } = dosDateTime(entry.modified ?? new Date());
    const size = entry.data.length;
    const crc = crc32(entry.data);
    if (size > MAX_SIZE || offset > MAX_SIZE) throw new Error('These files are too large for a ZIP — download them one at a time.');

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, SIG_LOCAL, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, 0, true); // method 0 = stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true); // compressed size = size, nothing is compressed
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true); // no extra field
    parts.push(new Uint8Array(local.buffer), name, entry.data);

    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, SIG_CENTRAL, true);
    record.setUint16(4, 20, true); // version made by
    record.setUint16(6, 20, true); // version needed
    record.setUint16(8, UTF8_NAMES, true);
    record.setUint16(10, 0, true);
    record.setUint16(12, time, true);
    record.setUint16(14, date, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, size, true);
    record.setUint32(24, size, true);
    record.setUint16(28, name.length, true);
    record.setUint16(30, 0, true); // extra
    record.setUint16(32, 0, true); // comment
    record.setUint16(34, 0, true); // disk number
    record.setUint16(36, 0, true); // internal attributes
    record.setUint32(38, 0, true); // external attributes
    record.setUint32(42, offset, true);
    central.push(new Uint8Array(record.buffer), name);

    offset += 30 + name.length + size;
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  if (offset + centralSize > MAX_SIZE) throw new Error('These files are too large for a ZIP — download them one at a time.');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, SIG_END, true);
  end.setUint16(4, 0, true); // this disk
  end.setUint16(6, 0, true); // disk with the central directory
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true); // no comment
  return [...parts, ...central, new Uint8Array(end.buffer)];
}

/** The whole archive in one buffer. */
export function zipStore(entries: readonly ZipEntry[]): Uint8Array {
  const parts = zipParts(entries);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The archive as a Blob, built from the chunks (no giant intermediate buffer). */
export function zipBlob(entries: readonly ZipEntry[]): Blob {
  return new Blob(zipParts(entries) as BlobPart[], { type: 'application/zip' });
}
