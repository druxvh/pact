/**
 * JPEG EXIF orientation (1–8). Phones store photos sideways and add a tag saying "rotate me"; PDF embedding ignores
 * that tag, so a photo would land in the PDF on its side. We read the tag and bake the rotation in first.
 * Returns 1 (upright) for anything that isn't a JPEG or has no tag.
 */
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return 1;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xda || marker === 0xd9) return 1; // image data / end: no EXIF before it
    const size = view.getUint16(offset + 2);
    if (size < 2) return 1;
    if (marker === 0xe1 && offset + 10 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966 /* "Exif" */) {
      const tiff = offset + 10;
      if (tiff + 8 > view.byteLength) return 1;
      const little = view.getUint16(tiff) === 0x4949;
      if (!little && view.getUint16(tiff) !== 0x4d4d) return 1;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > view.byteLength) return 1;
      const entries = view.getUint16(ifd, little);
      for (let i = 0; i < entries; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > view.byteLength) return 1;
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset += 2 + size;
  }
  return 1;
}
