// @vitest-environment node
import { degrees, PDFDict, PDFDocument, PDFName, type PDFNumber } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { makePdf, pageContent } from './fixtures';
import { normalizeRotation, pointToUser, visualSize } from './geometry';
import type { WatermarkOptions } from './types';
import { measureFonts, watermarkPdf } from './watermark';
import { CAP_HEIGHT, cleanText, layoutStamps, parseHexColor, textWidth, unsupportedChars } from './watermarkLayout';

const options = (patch: Partial<WatermarkOptions> = {}): WatermarkOptions => ({
  text: 'DRAFT',
  size: 40,
  bold: false,
  color: '#ff0000',
  opacity: 0.3,
  rotation: 0,
  layout: 'single',
  position: 'center',
  pages: null,
  ...patch,
});

/** The text matrices (`a b c d e f Tm`) on a page, as numbers. */
const textMatrices = (content: string) =>
  [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm/g)].map((m) => m.slice(1, 7).map(Number));

const page = { width: 600, height: 800 };
const box = (stamp: { x: number; y: number; angle: number }, w: number, h: number) => {
  // centre of the text box, from the stamp's baseline origin
  const a = (stamp.angle * Math.PI) / 180;
  return { x: stamp.x + (w / 2) * Math.cos(a) - (h / 2) * Math.sin(a), y: stamp.y + (w / 2) * Math.sin(a) + (h / 2) * Math.cos(a) };
};

describe('layoutStamps: single', () => {
  const w = 200;
  const h = 40 * CAP_HEIGHT;
  const single = (position: Parameters<typeof layoutStamps>[3]['position'], rotation = 0) =>
    layoutStamps(page, w, h, { rotation, layout: 'single', position })[0];

  it('centres the text box in the middle of the page', () => {
    const c = box(single('center') as never, w, h);
    expect(c.x).toBeCloseTo(300);
    expect(c.y).toBeCloseTo(400);
  });
  it('puts the nine positions where they say (y goes up)', () => {
    const at = (p: Parameters<typeof single>[0]) => box(single(p) as never, w, h);
    const m = 600 * 0.04; // margin is 4% of the short side
    expect(at('top-left').x).toBeCloseTo(m + w / 2);
    expect(at('top-left').y).toBeCloseTo(800 - m - h / 2);
    expect(at('bottom-right').x).toBeCloseTo(600 - m - w / 2);
    expect(at('bottom-right').y).toBeCloseTo(m + h / 2);
    expect(at('top').x).toBeCloseTo(300);
    expect(at('left').y).toBeCloseTo(400);
    expect(at('bottom').y).toBeCloseTo(m + h / 2);
    expect(at('right').x).toBeCloseTo(600 - m - w / 2);
  });
  it('keeps the turned box on the page: a vertical word hugs the side by its height, not its length', () => {
    const c = box(single('left', 90) as never, w, h);
    expect(c.x).toBeCloseTo(24 + h / 2); // 24 = margin, h/2 = half the turned width
    const diagonal = box(single('top-right', 45) as never, w, h);
    const half = (w + h) * Math.SQRT1_2 * 0.5;
    expect(diagonal.x).toBeCloseTo(600 - 24 - half);
    expect(diagonal.y).toBeCloseTo(800 - 24 - half);
  });
  it('centres text that is too big for the page on that axis instead of hanging off one side', () => {
    const c = box(layoutStamps({ width: 100, height: 100 }, 400, 30, { rotation: 0, layout: 'single', position: 'top-left' })[0] as never, 400, 30);
    expect(c.x).toBeCloseTo(50);
  });
  it('reports the angle it was asked for', () => {
    expect(single('center', 30)?.angle).toBe(30);
    expect(single('center', -45)?.angle).toBe(-45);
  });
});

describe('layoutStamps: tiled', () => {
  const w = 120;
  const h = 20;
  it('fills the page with copies, none of them off the page entirely', () => {
    const stamps = layoutStamps(page, w, h, { rotation: 0, layout: 'tiled', position: 'center' });
    expect(stamps.length).toBeGreaterThan(20);
    for (const s of stamps) {
      const c = box(s, w, h);
      expect(c.x).toBeGreaterThan(-w / 2);
      expect(c.x).toBeLessThan(600 + w / 2);
      expect(c.y).toBeGreaterThan(-h / 2);
      expect(c.y).toBeLessThan(800 + h / 2);
    }
    // The pattern covers every part of the page: for any point there is a copy within one step.
    for (const [px, py] of [
      [10, 10],
      [590, 10],
      [10, 790],
      [590, 790],
      [300, 400],
      [150, 600],
    ] as const) {
      expect(stamps.some((s) => Math.abs(box(s, w, h).x - px) < w * 1.4 && Math.abs(box(s, w, h).y - py) < h * 6)).toBe(true);
    }
  });
  it('never overlaps copies of the text (checked unrotated, where boxes are axis-aligned)', () => {
    const boxes = layoutStamps(page, w, h, { rotation: 0, layout: 'tiled', position: 'center' }).map((s) => ({ x: s.x, y: s.y }));
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) expect(Math.abs(a.x - b.x) >= w || Math.abs(a.y - b.y) >= h).toBe(true);
    }
  });
  it('turns the whole lattice with the text', () => {
    const stamps = layoutStamps(page, w, h, { rotation: 45, layout: 'tiled', position: 'center' });
    expect(stamps.every((s) => s.angle === 45)).toBe(true);
    expect(stamps.length).toBeGreaterThan(20);
  });
  it('caps the number of copies for tiny text on huge pages', () => {
    const stamps = layoutStamps({ width: 5000, height: 7000 }, 12, 4, { rotation: 0, layout: 'tiled', position: 'center' });
    expect(stamps.length).toBeLessThan(5000);
  });
});

describe('text helpers', () => {
  const widths = { A: 0.5, B: 0.25, ' ': 0.25 };
  it('measures, collapses whitespace and finds characters the font cannot draw', () => {
    expect(textWidth('AB A', 10, widths)).toBeCloseTo(0.5 * 10 + 0.25 * 10 + 0.25 * 10 + 0.5 * 10);
    expect(cleanText('  Top\n\n secret\t ')).toBe('Top secret');
    expect(unsupportedChars('A Жж😀 Ж', widths)).toEqual(['Ж', 'ж', '😀']);
  });
  it('reads hex colours', () => {
    expect(parseHexColor('#ff0000')).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseHexColor('0f0')).toEqual({ r: 0, g: 1, b: 0 });
    expect(parseHexColor('nonsense')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexColor('#336699').b).toBeCloseTo(0.6);
  });
});

describe('measureFonts', () => {
  it('knows Helvetica’s widths and which characters it cannot draw', async () => {
    const { regular, bold } = await measureFonts();
    expect(regular.A).toBeCloseTo(0.667, 3);
    expect(bold.A).toBeCloseTo(0.722, 3);
    expect(regular[' ']).toBeCloseTo(0.278, 3);
    expect(regular.é).toBeGreaterThan(0);
    expect(regular.Ж).toBeUndefined();
    expect(regular['😀']).toBeUndefined();
  });
});

describe('watermarkPdf', () => {
  it('stamps every page by default and only the chosen pages when asked', async () => {
    const src = await makePdf(3);
    const all = await watermarkPdf(src, options());
    for (const i of [0, 1, 2]) expect(await pageContent(all, i)).toContain(' Tm');
    const some = await watermarkPdf(src, options({ pages: [1] }));
    expect(await pageContent(some, 0)).not.toContain(' Tm');
    expect(await pageContent(some, 1)).toContain(' Tm');
    expect(await pageContent(some, 2)).not.toContain(' Tm');
    expect((await PDFDocument.load(some)).getPageCount()).toBe(3);
  });
  it('sets colour and opacity (one shared graphics state)', async () => {
    const out = await watermarkPdf(await makePdf(2), options({ color: '#336699', opacity: 0.4 }));
    const content = await pageContent(out, 0);
    expect(content).toMatch(/0\.2 0\.4 0\.6 rg/);
    const doc = await PDFDocument.load(out);
    const states = doc.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .filter((o): o is PDFDict => o instanceof PDFDict && o.lookup(PDFName.of('Type')) === PDFName.of('ExtGState'));
    expect(states).toHaveLength(1); // two pages, one graphics state
    const state = states[0] as PDFDict;
    expect((state.lookup(PDFName.of('ca')) as PDFNumber).asNumber()).toBeCloseTo(0.4);
    expect((state.lookup(PDFName.of('CA')) as PDFNumber).asNumber()).toBeCloseTo(0.4);
  });
  it('writes one text object per page however many tiles there are', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([600, 800]);
    const out = await watermarkPdf(await doc.save(), options({ layout: 'tiled', size: 14 }));
    const content = await pageContent(out, 0);
    expect(content.match(/ Tm/g)?.length).toBeGreaterThan(10);
    expect(content.match(/\bBT\b/g)).toHaveLength(1);
  });
  it('puts the text on the visual centre of pages of every rotation, turned with the page', async () => {
    const m = await measureFonts();
    const text = 'CENTER';
    const w = textWidth(text, 40, m.regular);
    const h = 40 * CAP_HEIGHT;
    for (const rotation of [0, 90, 180, 270]) {
      const doc = await PDFDocument.create();
      const p = doc.addPage([200, 400]);
      p.setRotation(degrees(rotation));
      const out = await watermarkPdf(await doc.save(), options({ text, size: 40, rotation: 30 }));
      const [a, b, c, d, e, f] = textMatrices(await pageContent(out, 0)).at(-1) as number[];
      // Where the middle of the text box lands in the page's own space…
      const centre = {
        x: (e as number) + (w / 2) * (a as number) + (h / 2) * (c as number),
        y: (f as number) + (w / 2) * (b as number) + (h / 2) * (d as number),
      };
      // …is where the middle of the page the viewer sees maps to.
      const reloaded = (await PDFDocument.load(out)).getPage(0);
      const want = pointToUser(reloaded.getCropBox(), normalizeRotation(reloaded.getRotation().angle), 0.5, 0.5);
      expect(centre.x).toBeCloseTo(want.x, 3);
      expect(centre.y).toBeCloseTo(want.y, 3);
      // The turn the viewer sees is the requested 30°: the page's own turn is added to (and so cancelled out by) the display rotation.
      const angle = (Math.atan2(b as number, a as number) * 180) / Math.PI;
      expect((((angle - rotation) % 360) + 360) % 360).toBeCloseTo(30, 3);
      expect(visualSize(reloaded.getCropBox(), normalizeRotation(rotation)).width).toBe(rotation % 180 === 0 ? 200 : 400);
    }
  });
  it('explains what it can’t do', async () => {
    const src = await makePdf(2);
    await expect(watermarkPdf(src, options({ text: '   ' }))).rejects.toThrow('Type the text');
    await expect(watermarkPdf(src, options({ text: 'Привет' }))).rejects.toThrow('can’t draw “П”');
    await expect(watermarkPdf(src, options({ text: 'x'.repeat(81) }))).rejects.toThrow('under 80');
    await expect(watermarkPdf(src, options({ size: 2 }))).rejects.toThrow('font size');
    await expect(watermarkPdf(src, options({ pages: [5] }))).rejects.toThrow('pages that exist');
    await expect(watermarkPdf(src, options({ pages: [] }))).rejects.toThrow('pages that exist');
    await expect(watermarkPdf(new Uint8Array([1]), options())).rejects.toThrow('valid PDF');
  });
});
