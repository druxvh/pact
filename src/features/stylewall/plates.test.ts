import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { styleWallpaperDef } from '@/lib/appearance/themeStyle';
import { STYLEWALL_CREDITS } from './credits';
import { classOfAlpha, DEFAULT_PLATE, PLATE_CLASS, PLATES, plateById } from './plates';
import { must } from './testUtil';

const dir = resolve(__dirname, 'plates');

/** IHDR and the palette (PLTE / tRNS) of a PNG on disk. */
function inspect(file: string) {
  const buf = readFileSync(resolve(dir, file));
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let trns: number[] = [];
  let entries = 0;
  for (let p = 8; p < buf.length; ) {
    const len = dv.getUint32(p);
    const type = buf.subarray(p + 4, p + 8).toString('latin1');
    if (type === 'PLTE') entries = len / 3;
    if (type === 'tRNS') trns = [...buf.subarray(p + 8, p + 8 + len)];
    p += 12 + len;
  }
  return { bytes: buf.length, w: dv.getUint32(16), h: dv.getUint32(20), depth: buf[24], colour: buf[25], entries, trns };
}

describe('engraving plates', () => {
  it('the default plate exists and unknown ids fall back to it', () => {
    expect(PLATES[DEFAULT_PLATE]).toBeDefined();
    expect(plateById('nope')).toBe(plateById(DEFAULT_PLATE));
  });

  it('every plate PNG is the size its entry says, a 2-bit indexed image with the four alpha-coded classes, and small', () => {
    for (const def of Object.values(PLATES)) {
      const file = def.src.split('/').pop() as string;
      const png = inspect(file);
      expect(png.w, `${file} width`).toBe(def.w);
      expect(png.h, `${file} height`).toBe(def.h);
      expect(png.colour).toBe(3);
      expect(png.depth).toBe(2);
      expect(png.entries).toBe(4);
      expect(png.trns).toEqual([0, 96, 176, 255]);
      expect(png.bytes).toBeLessThan(150 * 1024);
    }
  });

  it('reads classes back from alpha exactly (the PNG stores 0 / 96 / 176 / 255)', () => {
    expect(classOfAlpha(0)).toBe(PLATE_CLASS.empty);
    expect(classOfAlpha(96)).toBe(PLATE_CLASS.lit);
    expect(classOfAlpha(176)).toBe(PLATE_CLASS.shade);
    expect(classOfAlpha(255)).toBe(PLATE_CLASS.edge);
    // a decoder that is off by a little still lands in the right class
    for (const [a, c] of [
      [10, 0],
      [120, 1],
      [200, 2],
      [240, 3],
    ] as const)
      expect(classOfAlpha(a)).toBe(c);
    expect(must(PLATES.halo).fill).toBeLessThanOrEqual(1.05);
  });

  it('the Ultramarine style offers all three plates, Marcus first (the default), each with a picture', () => {
    const ids = styleWallpaperDef('ultramarine')?.plates?.map((p) => p.id);
    expect(ids).toEqual(['halo', 'rose', 'melencolia']);
    for (const id of ids ?? []) expect(PLATES[id]).toBeDefined();
  });

  it('plates that fill the roundel (Doré, Dürer) are square, overfill its circle and skip the stipple ground; the bust sits on the floor', () => {
    for (const id of ['rose', 'melencolia']) {
      const def = must(PLATES[id]);
      expect(def.w).toBe(def.h);
      expect(def.fill).toBeGreaterThan(1.03); // a little over the roundel's circle, so parallax never shows its edge
      expect(def.fill).toBeLessThan(1.15);
      expect(def.valign).toBe(0.5);
      expect(def.flat).toBe(true);
    }
    expect(must(PLATES.halo).valign).toBe(1);
    expect(must(PLATES.halo).flat).toBeUndefined();
  });

  it('every plate made from a Commons picture is credited: title, author, public domain, a Commons file link, and what was done', () => {
    const credit = (id: string) => must(STYLEWALL_CREDITS.find((c) => c.id === id));
    for (const id of ['halo-plate', 'rose-plate', 'melencolia-plate']) {
      const c = credit(id);
      expect(c.licence).toBe('Public domain');
      expect(c.sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(c.creator.length).toBeGreaterThan(2);
      expect(c.subject.length).toBeGreaterThan(5);
    }
    expect(credit('rose-plate').creator).toBe('Gustave Doré');
    expect(credit('melencolia-plate').creator).toBe('Albrecht Dürer');
    for (const id of ['rose-plate', 'melencolia-plate']) expect(credit(id).changes).toContain('duotone engraving plate');
    expect(credit('rose-plate').file).toBe('Paradiso Canto 31 (no caption).jpg');
    expect(credit('melencolia-plate').file).toBe('Dürer Melancholia I.jpg');
  });
});
