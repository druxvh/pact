import { degrees, PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { inkBounds, whiteToAlpha } from '../../pdf/signature';
import { jpegOrientation } from './exif';
import { annotationSummary, lastImageBox, makeLinkedPdf, makeSharedPdf, pageContent } from './fixtures';
import {
  clampRect,
  FULL_PAGE,
  fitAspect,
  fractionAspect,
  heightForWidth,
  isFullPage,
  marginsFromRect,
  normalizeRotation,
  placeUpright,
  pointToUser,
  rectFromMargins,
  resizeRect,
  visualSize,
  visualToUser,
} from './geometry';
import { assemble, cropPdf, imagesToPdf, mergePdfs, PdfError, pageCount, signPdf } from './ops';

/** A PDF whose page i is (100 + i*10) wide and 200 tall, so pages can be told apart by size. */
async function makePdf(pages: number, rotations: number[] = []): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([100 + i * 10, 200]);
    if (rotations[i]) p.setRotation(degrees(rotations[i] as number));
  }
  return doc.save();
}
const widths = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth());

// A real 1×1 PNG.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));

describe('geometry: visual fractions → PDF user space', () => {
  const box = { x: 0, y: 0, width: 200, height: 100 };
  const q = { left: 0, top: 0, width: 0.5, height: 0.5 }; // the top-left quarter as displayed

  it('rotation 0: top-left of the screen is top-left of user space', () => {
    expect(visualToUser(box, 0, q)).toEqual({ x: 0, y: 50, width: 100, height: 50 });
  });
  it('rotation 90 (clockwise): the displayed top-left is the user-space bottom-left', () => {
    expect(visualToUser(box, 90, q)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
  });
  it('rotation 180: the displayed top-left is the user-space bottom-right', () => {
    expect(visualToUser(box, 180, q)).toEqual({ x: 100, y: 0, width: 100, height: 50 });
  });
  it('rotation 270: the displayed top-left is the user-space top-right', () => {
    expect(visualToUser(box, 270, q)).toEqual({ x: 100, y: 50, width: 100, height: 50 });
  });
  it('the full page maps to the full box for every rotation, and corners round-trip distinctly', () => {
    for (const r of [0, 90, 180, 270] as const) {
      expect(visualToUser(box, r, { left: 0, top: 0, width: 1, height: 1 })).toEqual(box);
      const corners = [pointToUser(box, r, 0, 0), pointToUser(box, r, 1, 0), pointToUser(box, r, 1, 1), pointToUser(box, r, 0, 1)].map((p) => `${p.x},${p.y}`);
      expect(new Set(corners).size).toBe(4);
    }
  });
  it('respects a box that does not start at the origin', () => {
    expect(visualToUser({ x: 10, y: 20, width: 100, height: 50 }, 0, { left: 0.5, top: 0, width: 0.5, height: 1 })).toEqual({
      x: 60,
      y: 20,
      width: 50,
      height: 50,
    });
  });
  it('visual size swaps on quarter turns', () => {
    expect(visualSize(box, 90)).toEqual({ width: 100, height: 200 });
    expect(visualSize(box, 180)).toEqual({ width: 200, height: 100 });
  });
  it('places an upright image at the visual bottom-left of its rectangle, turned with the page', () => {
    const at = placeUpright(box, 90, { left: 0, top: 0, width: 0.5, height: 0.5 });
    expect(at).toMatchObject({ angle: 90, width: 0.5 * 100, height: 0.5 * 200 });
    expect(at.x).toBeCloseTo(100); // visual bottom-left (u=0, v=0.5) → user (v*W, u*H) = (100, 0)
    expect(at.y).toBeCloseTo(0);
  });
  it('normalises rotations and clamps rectangles', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(clampRect({ left: 0.9, top: -1, width: 0.5, height: 2 })).toEqual({ left: 0.5, top: 0, width: 0.5, height: 1 });
  });
});

describe('assemble / merge', () => {
  it('merges files in order', async () => {
    const out = await mergePdfs([await makePdf(2), await makePdf(1)]);
    expect(await widths(out)).toEqual([100, 110, 100]);
  });
  it('reorders, deletes and extracts pages', async () => {
    const src = await makePdf(4); // widths 100,110,120,130
    const out = await assemble(
      [src],
      [3, 0, 2].map((page) => ({ source: 0, page, rotate: 0 })),
    );
    expect(await widths(out)).toEqual([130, 100, 120]);
  });
  it('mixes pages from different files', async () => {
    const a = await makePdf(2);
    const b = await makePdf(3);
    const out = await assemble(
      [a, b],
      [
        { source: 1, page: 2, rotate: 0 },
        { source: 0, page: 1, rotate: 0 },
      ],
    );
    expect(await widths(out)).toEqual([120, 110]);
  });
  it('rotates on top of the page’s own rotation', async () => {
    const src = await makePdf(2, [90, 0]);
    const out = await assemble(
      [src],
      [
        { source: 0, page: 0, rotate: 90 },
        { source: 0, page: 1, rotate: 270 },
      ],
    );
    const pages = (await PDFDocument.load(out)).getPages();
    expect(pages.map((p) => p.getRotation().angle)).toEqual([180, 270]);
  });
  it('refuses nonsense with a clear message', async () => {
    const src = await makePdf(1);
    await expect(assemble([src], [])).rejects.toThrow('at least one page');
    await expect(assemble([src], [{ source: 0, page: 5, rotate: 0 }])).rejects.toThrow('doesn’t exist');
    await expect(mergePdfs([src])).rejects.toThrow('at least two');
    await expect(pageCount(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(PdfError);
  });
});

describe('cropPdf', () => {
  it('crops to the requested area and leaves other pages alone', async () => {
    const src = await makePdf(2); // 100x200 and 110x200
    const out = await cropPdf(src, [{ left: 0.1, top: 0.25, width: 0.5, height: 0.5 }, null]);
    const [p1, p2] = (await PDFDocument.load(out)).getPages();
    expect(p1?.getCropBox()).toEqual({ x: 10, y: 50, width: 50, height: 100 });
    expect(p1?.getMediaBox()).toEqual({ x: 10, y: 50, width: 50, height: 100 });
    expect(p2?.getWidth()).toBe(110);
  });
  it('crops a rotated page in what you see, not in raw coordinates', async () => {
    const src = await makePdf(1, [90]); // 100x200 raw, displayed 200 wide x 100 tall
    const out = await cropPdf(src, [{ left: 0, top: 0, width: 0.5, height: 1 }]); // the left half as displayed
    const box = (await PDFDocument.load(out)).getPage(0).getCropBox();
    expect(box).toEqual({ x: 0, y: 0, width: 100, height: 100 }); // bottom half of the raw page
  });
  it('rejects a crop that is practically empty', async () => {
    await expect(cropPdf(await makePdf(1), [{ left: 0, top: 0, width: 0.001, height: 0.001 }])).rejects.toThrow('too small');
  });
});

describe('imagesToPdf', () => {
  it('makes one page per image, sized to fit', async () => {
    const out = await imagesToPdf(
      [
        { bytes: PNG, kind: 'png' },
        { bytes: PNG, kind: 'png' },
      ],
      { size: 'fit', margin: 0, orientation: 'auto' },
    );
    const pages = (await PDFDocument.load(out)).getPages();
    expect(pages).toHaveLength(2);
    expect(pages[0]?.getWidth()).toBeCloseTo(0.75);
  });
  it('lays images out on A4 and Letter, centred, with orientation', async () => {
    const a4 = (await PDFDocument.load(await imagesToPdf([{ bytes: PNG, kind: 'png' }], { size: 'a4', margin: 36, orientation: 'portrait' }))).getPage(0);
    expect([Math.round(a4.getWidth()), Math.round(a4.getHeight())]).toEqual([595, 842]);
    const letterLand = (
      await PDFDocument.load(await imagesToPdf([{ bytes: PNG, kind: 'png' }], { size: 'letter', margin: 0, orientation: 'landscape' }))
    ).getPage(0);
    expect([Math.round(letterLand.getWidth()), Math.round(letterLand.getHeight())]).toEqual([792, 612]);
  });
  it('needs at least one image', async () => {
    await expect(imagesToPdf([], { size: 'a4', margin: 0, orientation: 'auto' })).rejects.toThrow('at least one image');
  });
});

describe('signPdf', () => {
  it('draws the signature and keeps the page count', async () => {
    const src = await makePdf(2);
    const out = await signPdf(src, [{ page: 1, rect: { left: 0.1, top: 0.7, width: 0.4, height: 0.1 }, png: PNG }]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(2);
    expect(out.length).toBeGreaterThan(src.length); // an image XObject was added
  });
  it('works on every rotation', async () => {
    for (const r of [0, 90, 180, 270]) {
      const out = await signPdf(await makePdf(1, [r]), [{ page: 0, rect: { left: 0.2, top: 0.2, width: 0.3, height: 0.1 }, png: PNG }]);
      expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
    }
  });
  it('rejects empty placements and missing pages', async () => {
    const src = await makePdf(1);
    await expect(signPdf(src, [])).rejects.toThrow('Place a signature');
    await expect(signPdf(src, [{ page: 3, rect: { left: 0, top: 0, width: 0.1, height: 0.1 }, png: PNG }])).rejects.toThrow('doesn’t exist');
  });
});

describe('jpegOrientation', () => {
  /** A minimal JPEG header carrying an EXIF orientation tag. */
  function jpegWith(orientation: number, little = true): Uint8Array {
    const t: number[] = [];
    const u16 = (n: number) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255]);
    const u32 = (n: number) => (little ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
    t.push(
      ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
      ...u16(42),
      ...u32(8),
      ...u16(1),
      ...u16(0x0112),
      ...u16(3),
      ...u32(1),
      ...u16(orientation),
      0,
      0,
      ...u32(0),
    );
    const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...t];
    const len = exif.length + 2;
    return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...exif, 0xff, 0xd9]);
  }
  it('reads the tag in both byte orders', () => {
    for (const o of [1, 3, 6, 8]) {
      expect(jpegOrientation(jpegWith(o, true))).toBe(o);
      expect(jpegOrientation(jpegWith(o, false))).toBe(o);
    }
  });
  it('treats non-JPEGs, junk and out-of-range values as upright', () => {
    expect(jpegOrientation(PNG)).toBe(1);
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8]))).toBe(1);
    expect(jpegOrientation(jpegWith(9))).toBe(1);
    expect(jpegOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x04, 1, 2]))).toBe(1);
  });
});

describe('resizeRect (dragging handles)', () => {
  const r = { left: 0.2, top: 0.2, width: 0.4, height: 0.4 };
  const same = (got: { left: number; top: number; width: number; height: number }, want: { left: number; top: number; width: number; height: number }) => {
    expect(got.left).toBeCloseTo(want.left);
    expect(got.top).toBeCloseTo(want.top);
    expect(got.width).toBeCloseTo(want.width);
    expect(got.height).toBeCloseTo(want.height);
  };
  it('moves and keeps the rectangle on the page', () => {
    same(resizeRect(r, 'move', 0.1, -0.1), { left: 0.3, top: 0.1, width: 0.4, height: 0.4 });
    same(resizeRect(r, 'move', 5, 5), { left: 0.6, top: 0.6, width: 0.4, height: 0.4 });
    same(resizeRect(r, 'move', -5, -5), { left: 0, top: 0, width: 0.4, height: 0.4 });
  });
  it('resizes each edge and corner from the opposite side', () => {
    same(resizeRect(r, 'e', 0.1, 0), { left: 0.2, top: 0.2, width: 0.5, height: 0.4 });
    same(resizeRect(r, 'w', -0.1, 0), { left: 0.1, top: 0.2, width: 0.5, height: 0.4 });
    same(resizeRect(r, 'se', 0.1, 0.2), { left: 0.2, top: 0.2, width: 0.5, height: 0.6 });
    same(resizeRect(r, 'nw', -0.1, -0.1), { left: 0.1, top: 0.1, width: 0.5, height: 0.5 });
  });
  it('never goes off the page or below the minimum, and never flips', () => {
    expect(resizeRect(r, 'e', 5, 0).left + resizeRect(r, 'e', 5, 0).width).toBe(1);
    const squeezed = resizeRect(r, 'w', 5, 0, { minW: 0.05 });
    expect(squeezed.width).toBeCloseTo(0.05);
    expect(squeezed.left).toBeCloseTo(0.55);
    const up = resizeRect(r, 's', 0, -5, { minH: 0.1 });
    expect(up.height).toBeCloseTo(0.1);
    expect(up.top).toBe(0.2);
  });
  it('locks the shape on corners and keeps the far corner fixed', () => {
    const start = { left: 0.2, top: 0.2, width: 0.3, height: 0.1 }; // aspect 3
    const grown = resizeRect(start, 'se', 0.1, 0, { aspect: 3 });
    expect(grown.left).toBe(0.2);
    expect(grown.top).toBe(0.2);
    expect(grown.width / grown.height).toBeCloseTo(3);
    expect(grown.width).toBeCloseTo(0.4);
    const nw = resizeRect(start, 'nw', -0.1, 0, { aspect: 3 });
    expect(nw.left + nw.width).toBeCloseTo(0.5); // the east edge didn't move
    expect(nw.top + nw.height).toBeCloseTo(0.3); // nor the south edge
    expect(nw.width / nw.height).toBeCloseTo(3);
    const huge = resizeRect(start, 'se', 5, 5, { aspect: 3 });
    expect(huge.left + huge.width).toBeLessThanOrEqual(1 + 1e-9);
    expect(huge.top + huge.height).toBeLessThanOrEqual(1 + 1e-9);
    expect(huge.width / huge.height).toBeCloseTo(3);
  });
  it('converts between margins and rectangles', () => {
    const rect = rectFromMargins({ top: 0.1, right: 0.2, bottom: 0.3, left: 0.05 });
    expect(rect).toEqual({ left: 0.05, top: 0.1, width: expect.closeTo(0.75), height: expect.closeTo(0.6) });
    const m = marginsFromRect(rect);
    expect([m.top, m.right, m.bottom, m.left]).toEqual([expect.closeTo(0.1), expect.closeTo(0.2), expect.closeTo(0.3), expect.closeTo(0.05)]);
    expect(isFullPage(FULL_PAGE)).toBe(true);
    expect(isFullPage(rect)).toBe(false);
  });
});

describe('signature pixels', () => {
  it('finds the ink bounds and reports an empty canvas', () => {
    const w = 6;
    const h = 4;
    const px = new Uint8ClampedArray(w * h * 4);
    expect(inkBounds(px, w, h)).toBeNull();
    px[(1 * w + 2) * 4 + 3] = 255;
    px[(2 * w + 4) * 4 + 3] = 255;
    expect(inkBounds(px, w, h)).toEqual({ x: 2, y: 1, w: 3, h: 2 });
  });
  it('turns white paper transparent but keeps ink', () => {
    const px = Uint8ClampedArray.from([255, 255, 255, 255, 20, 20, 120, 255, 200, 200, 200, 255]);
    whiteToAlpha(px);
    expect(px[3]).toBe(0); // white → gone
    expect(px[7]).toBe(255); // dark ink stays
    expect(px[11]).toBeGreaterThan(0); // light grey: partly transparent
    expect(px[11]).toBeLessThan(255);
  });
});

describe('merge and extract do not inflate the file', () => {
  it('copies a resource shared by many pages once per source, not once per page', async () => {
    const src = await makeSharedPdf(20); // 20 pages, one 200 KB image used by all of them
    const merged = await mergePdfs([src, src]);
    // Two sources → two copies of the image are legitimate. The per-page copier wrote 40 (≈ 8 MB).
    expect(merged.length).toBeLessThan(src.length * 2 * 1.15);
    expect((await PDFDocument.load(merged)).getPageCount()).toBe(40);
  });
  it('extracting some pages keeps one copy of what they share', async () => {
    const src = await makeSharedPdf(20);
    const out = await assemble(
      [src],
      [0, 5, 6, 7, 12].map((page) => ({ source: 0, page, rotate: 0 })),
    );
    expect(out.length).toBeLessThan(src.length * 1.1);
  });
  it('a page used twice shares its resources with itself', async () => {
    const src = await makeSharedPdf(2);
    const out = await assemble(
      [src],
      [0, 0, 0].map((page) => ({ source: 0, page, rotate: 0 })),
    );
    expect(out.length).toBeLessThan(src.length * 1.15);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });
  it('only reads the files that contribute pages', async () => {
    const good = await makePdf(2);
    const out = await assemble([good, new Uint8Array([1, 2, 3])], [{ source: 0, page: 1, rotate: 0 }]); // source 1 isn't a PDF, but isn't used
    expect(await widths(out)).toEqual([110]);
  });
  it('drops links to other pages instead of dragging those pages along, and keeps web links', async () => {
    const src = await makeLinkedPdf(10); // page 1 links to page 10; every page has its own 150 KB image
    expect(await annotationSummary(src, 0)).toEqual({ total: 2, internal: 1, uris: 1 });
    const one = await assemble([src], [{ source: 0, page: 0, rotate: 0 }]);
    expect(one.length).toBeLessThan(180_000); // one page's image — not two (page 10 would have come along)
    expect(await annotationSummary(one, 0)).toEqual({ total: 1, internal: 0, uris: 1 });
    const merged = await mergePdfs([src, src]);
    expect(merged.length).toBeLessThan(src.length * 2 * 1.1);
  });
});

describe('signature geometry: preview and stamped output agree', () => {
  it('the shape of a locked signature box multiplies by the page ratio (it used to divide)', () => {
    // A signature 3× as wide as tall on a page twice as tall as wide: its box is 6:1 in page fractions.
    expect(fractionAspect(3, 2)).toBe(6);
    expect(heightForWidth(0.3, 3, 2)).toBeCloseTo(0.05);
    // …and back: a 0.3 × 0.05 box on that page is 0.3·W by 0.05·2W = 0.3W × 0.1W → 3:1 in pixels.
    expect((0.3 * 1) / (0.05 * 2)).toBeCloseTo(3);
  });
  it('placing at the computed height gives the picture its own proportions on every rotation', () => {
    const box = { x: 0, y: 0, width: 200, height: 400 };
    for (const rotation of [0, 90, 180, 270] as const) {
      const vis = visualSize(box, rotation);
      const height = heightForWidth(0.4, 2.5, vis.height / vis.width);
      const at = placeUpright(box, rotation, { left: 0.1, top: 0.2, width: 0.4, height });
      expect(at.width / at.height).toBeCloseTo(2.5);
    }
  });
  it('fitAspect keeps a correctly shaped rectangle, reshapes others, and keeps them on the page', () => {
    const ok = { left: 0.2, top: 0.3, width: 0.4, height: 0.4 / 6 };
    const same = fitAspect(ok, 6);
    expect(same.left).toBeCloseTo(ok.left);
    expect(same.top).toBeCloseTo(ok.top);
    expect(same.width).toBeCloseTo(ok.width);
    expect(same.height).toBeCloseTo(ok.height);
    const reshaped = fitAspect({ left: 0.1, top: 0.95, width: 0.5, height: 0.5 }, 2);
    expect(reshaped.width / reshaped.height).toBeCloseTo(2);
    expect(reshaped.top + reshaped.height).toBeLessThanOrEqual(1 + 1e-9);
    const tall = fitAspect({ left: 0, top: 0, width: 1, height: 0.1 }, 0.5); // would be 2 tall: shrink to fit
    expect(tall.height).toBe(1);
    expect(tall.width).toBeCloseTo(0.5);
  });
  it('stamps with the picture’s own shape even when the rectangle came from a page of other proportions', async () => {
    // Two pages: 100×200 (ratio 2) and 300×100 (ratio 1/3). The 1×1 PNG is square, so the stamp must be square on both.
    const doc = await PDFDocument.create();
    doc.addPage([100, 200]);
    doc.addPage([300, 100]);
    const src = await doc.save();
    const rect = { left: 0.1, top: 0.1, width: 0.4, height: 0.2 }; // square-ish on a 1:2 page only
    const out = await signPdf(src, [
      { page: 0, rect, png: PNG },
      { page: 1, rect, png: PNG },
    ]);
    for (const index of [0, 1]) {
      const stamp = lastImageBox(await pageContent(out, index));
      expect(stamp.width).toBeGreaterThan(1);
      expect(stamp.width / stamp.height).toBeCloseTo(1, 5);
    }
  });
});
