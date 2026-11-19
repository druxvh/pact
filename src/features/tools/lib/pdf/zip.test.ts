import { describe, expect, it } from 'vitest';
import { noise } from './fixtures';
import { crc32, dosDateTime, zipBlob, zipParts, zipSafeName, zipStore } from './zip';

const text = (s: string) => new TextEncoder().encode(s);

/** Bit-at-a-time reference CRC-32, to check the fast one against. */
function slowCrc(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

describe('crc32', () => {
  it('matches the published check values', () => {
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(text('a'))).toBe(0xe8b7be43);
    expect(crc32(text('abc'))).toBe(0x352441c2);
    expect(crc32(text('123456789'))).toBe(0xcbf43926); // the standard CRC-32 check value
    expect(crc32(text('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    expect(crc32(new Uint8Array(32))).toBe(0x190a55ad); // 32 zero bytes
    expect(crc32(new Uint8Array(32).fill(0xff))).toBe(0xff6cab0b); // 32 bytes of 0xFF
  });
  it('agrees with the bitwise reference for every length around the 8-byte stride, and for big inputs', () => {
    const data = noise(5000);
    for (let n = 0; n <= 40; n++) expect(crc32(data.subarray(0, n))).toBe(slowCrc(data.subarray(0, n)));
    expect(crc32(data)).toBe(slowCrc(data));
    const big = noise(300_001);
    expect(crc32(big)).toBe(slowCrc(big));
  });
  it('handles views that do not start at the beginning of their buffer', () => {
    const data = noise(100);
    expect(crc32(data.subarray(13, 77))).toBe(slowCrc(data.slice(13, 77)));
  });
  it('can be continued across chunks', () => {
    const data = noise(1000);
    expect(crc32(data.subarray(300), crc32(data.subarray(0, 300)))).toBe(crc32(data));
  });
  it('always returns an unsigned 32-bit number', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const c = crc32(noise(seed * 37));
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

/** A small ZIP reader (central directory first, like real tools) so the writer is checked against the format, not itself. */
function readZip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  expect(view.getUint16(eocd + 4, true)).toBe(0); // disk
  expect(view.getUint16(eocd + 20, true)).toBe(0); // comment length
  const count = view.getUint16(eocd + 10, true);
  expect(view.getUint16(eocd + 8, true)).toBe(count);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  expect(cdOffset + cdSize).toBe(eocd); // the directory ends exactly where the end record starts

  const files: Array<{ name: string; data: Uint8Array; crc: number; time: number; date: number }> = [];
  let at = cdOffset;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    expect(view.getUint16(at + 10, true)).toBe(0); // stored
    expect(view.getUint16(at + 8, true) & 0x0800).toBe(0x0800); // UTF-8 names
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    expect(view.getUint32(at + 24, true)).toBe(size);
    const nameLen = view.getUint16(at + 28, true);
    expect(view.getUint16(at + 30, true)).toBe(0);
    expect(view.getUint16(at + 32, true)).toBe(0);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
    // …and the local header must agree with the directory.
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint32(local + 14, true)).toBe(crc);
    expect(view.getUint32(local + 18, true)).toBe(size);
    expect(view.getUint32(local + 22, true)).toBe(size);
    expect(view.getUint16(local + 26, true)).toBe(nameLen);
    const start = local + 30 + nameLen + view.getUint16(local + 28, true);
    files.push({ name, data: zip.subarray(start, start + size), crc, time: view.getUint16(at + 12, true), date: view.getUint16(at + 14, true) });
    at += 46 + nameLen;
  }
  expect(at).toBe(cdOffset + cdSize);
  return files;
}

describe('zipStore', () => {
  it('round-trips names and bytes, with correct checksums', () => {
    const entries = [
      { name: 'one.pdf', data: noise(1000) },
      { name: 'two.pdf', data: text('hello') },
      { name: 'empty.pdf', data: new Uint8Array() },
    ];
    const files = readZip(zipStore(entries));
    expect(files.map((f) => f.name)).toEqual(['one.pdf', 'two.pdf', 'empty.pdf']);
    files.forEach((f, i) => {
      expect(Array.from(f.data)).toEqual(Array.from(entries[i]?.data ?? []));
      expect(f.crc).toBe(slowCrc(f.data));
    });
  });
  it('writes the known layout byte for byte (one file, fixed date)', () => {
    const modified = new Date(2024, 4, 17, 13, 45, 30); // 2024-05-17 13:45:30 local
    const zip = zipStore([{ name: 'a.txt', data: text('hi'), modified }]);
    const { time, date } = dosDateTime(modified);
    expect(time).toBe((13 << 11) | (45 << 5) | 15);
    expect(date).toBe(((2024 - 1980) << 9) | (5 << 5) | 17);
    // local header (30) + name (5) + data (2) + central (46) + name (5) + end (22)
    expect(zip.length).toBe(30 + 5 + 2 + 46 + 5 + 22);
    expect(Array.from(zip.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]); // "PK\3\4"
    expect(Array.from(zip.subarray(zip.length - 22, zip.length - 18))).toEqual([0x50, 0x4b, 0x05, 0x06]); // "PK\5\6"
    expect(readZip(zip)[0]).toMatchObject({ name: 'a.txt', time, date });
  });
  it('stores UTF-8 names and makes unsafe ones safe', () => {
    const files = readZip(
      zipStore([
        { name: 'résumé – 日本語.pdf', data: text('x') },
        { name: 'a/b\\c:d*e?.pdf', data: text('y') },
        { name: '   ', data: text('z') },
      ]),
    );
    expect(files.map((f) => f.name)).toEqual(['résumé – 日本語.pdf', 'a_b_c_d_e_.pdf', 'file']);
    expect(zipSafeName('x\u0001y')).toBe('x_y');
  });
  it('renames duplicates (case-insensitively) so every file can be extracted', () => {
    const files = readZip(
      zipStore([
        { name: 'part.pdf', data: text('1') },
        { name: 'PART.pdf', data: text('2') },
        { name: 'part.pdf', data: text('3') },
        { name: 'noext', data: text('4') },
        { name: 'noext', data: text('5') },
      ]),
    );
    expect(files.map((f) => f.name)).toEqual(['part.pdf', 'PART-2.pdf', 'part-3.pdf', 'noext', 'noext-2']);
  });
  it('writes an empty archive that readers accept', () => {
    const zip = zipStore([]);
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });
  it('handles many files', () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({ name: `f${i}.bin`, data: noise(i % 50) }));
    const files = readZip(zipStore(entries));
    expect(files).toHaveLength(300);
    expect(files[299]?.name).toBe('f299.bin');
  });
  it('clamps dates ZIP cannot represent', () => {
    expect(dosDateTime(new Date(1970, 0, 1)).date >> 9).toBe(0); // 1980
  });
  it('gives the chunks to a Blob without concatenating, and they add up to the whole archive', async () => {
    const entries = [
      { name: 'a.pdf', data: noise(2000) },
      { name: 'b.pdf', data: noise(3000) },
    ];
    const whole = zipStore(entries);
    expect(zipParts(entries).reduce((n, p) => n + p.length, 0)).toBe(whole.length);
    const blob = zipBlob(entries);
    expect(blob.type).toBe('application/zip');
    expect(blob.size).toBe(whole.length);
  });
});
