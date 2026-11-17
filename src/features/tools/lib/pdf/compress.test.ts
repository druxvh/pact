// @vitest-environment node
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { deflateRawStreams, dropUnreferenced, optimizePdf, reachableRefs, rebuildFromJpegs } from './compress';
import { JPEG, makePdf, makeSharedPdf, noise } from './fixtures';
import { isSmaller, MAX_PIXELS, MAX_SIDE_PX, percentSaved, RASTER_PRESETS, renderScale } from './rasterPlan';

/** A one-page PDF carrying `junk` bytes of unreferenced data and, optionally, a big *uncompressed* (so compressible) stream. */
async function makeMessyPdf(opts: { orphanBytes?: number; rawStreamBytes?: number }): Promise<{ bytes: Uint8Array; streamRef: string | null }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  if (opts.orphanBytes) doc.context.register(doc.context.stream(noise(opts.orphanBytes), { Note: 'nobody points here' }));
  let streamRef: string | null = null;
  if (opts.rawStreamBytes) {
    const ref = doc.context.register(
      doc.context.stream(new TextEncoder().encode('0 0 m 10 10 l S\n'.repeat(Math.ceil(opts.rawStreamBytes / 16))), { Kind: 'test' }),
    );
    page.node.set(PDFName.of('Extra'), ref); // reachable
    streamRef = ref.tag;
  }
  return { bytes: await doc.save(), streamRef };
}

describe('lossless clean-up', () => {
  it('removes objects nothing refers to, and only those', async () => {
    const { bytes } = await makeMessyPdf({ orphanBytes: 120_000 });
    const doc = await PDFDocument.load(bytes);
    const before = doc.context.enumerateIndirectObjects().length;
    expect(dropUnreferenced(doc.context)).toBeGreaterThanOrEqual(1);
    expect(doc.context.enumerateIndirectObjects().length).toBeLessThan(before);
    // The page tree, page and catalog are still reachable.
    expect(reachableRefs(doc.context).size).toBe(doc.context.enumerateIndirectObjects().length);
    expect(doc.getPageCount()).toBe(1);

    const out = await optimizePdf(bytes);
    expect(out.length).toBeLessThan(bytes.length - 100_000);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });

  it('Flate-compresses uncompressed streams, losslessly', async () => {
    const { bytes, streamRef } = await makeMessyPdf({ rawStreamBytes: 200_000 });
    expect(bytes.length).toBeGreaterThan(200_000);
    const out = await optimizePdf(bytes);
    expect(out.length).toBeLessThan(bytes.length * 0.1);

    // Decoding the new stream gives back exactly the original bytes.
    const doc = await PDFDocument.load(out);
    const original = await PDFDocument.load(bytes);
    const find = (d: PDFDocument) => d.context.enumerateIndirectObjects().find(([, o]) => o instanceof PDFRawStream && o.dict.has(PDFName.of('Kind')));
    const [, newStream] = find(doc) ?? [];
    const [oldRef, oldStream] = find(original) ?? [];
    expect(oldRef?.tag).toBe(streamRef);
    expect((newStream as PDFRawStream).dict.get(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'));
    expect(Array.from(decodePDFRawStream(newStream as PDFRawStream).decode())).toEqual(Array.from((oldStream as PDFRawStream).contents));
  });

  it('leaves compressed, tiny and incompressible streams alone', async () => {
    const src = await makeSharedPdf(3, 100_000); // its image is random: deflate can't shrink it
    const doc = await PDFDocument.load(src);
    expect(await deflateRawStreams(doc.context)).toBe(0);
  });

  it('keeps forms (everything reachable survives, not just pages)', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const field = doc.getForm().createTextField('name');
    field.setText('Ada');
    field.addToPage(page, { x: 20, y: 200, width: 150, height: 24 });
    const bytes = await doc.save();
    const out = await optimizePdf(bytes);
    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getTextField('name').getText()).toBe('Ada');
  });

  it('round-trips a plain document without growing it', async () => {
    const src = await makeSharedPdf(10, 50_000);
    const out = await optimizePdf(src);
    expect(out.length).toBeLessThanOrEqual(src.length * 1.02);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(10);
  });

  it('refuses things that are not PDFs with a clear message', async () => {
    await expect(optimizePdf(new Uint8Array([1, 2, 3]))).rejects.toThrow('doesn’t look like a valid PDF');
  });
});

describe('rebuildFromJpegs', () => {
  it('lays each picture on a page of the stated size', async () => {
    const out = await rebuildFromJpegs([
      { jpeg: JPEG, width: 612, height: 792 },
      { jpeg: JPEG, width: 300.5, height: 200.25 },
    ]);
    const pages = (await PDFDocument.load(out)).getPages();
    expect(pages.map((p) => [p.getWidth(), p.getHeight()])).toEqual([
      [612, 792],
      [300.5, 200.25],
    ]);
  });
  it('needs at least one page', async () => {
    await expect(rebuildFromJpegs([])).rejects.toThrow('no pages');
  });
});

describe('compress planning', () => {
  it('reports honest savings and never offers a bigger file', () => {
    expect(percentSaved(1000, 250)).toBe(75);
    expect(percentSaved(3, 2)).toBe(33.3);
    expect(percentSaved(1000, 1000)).toBe(0);
    expect(percentSaved(1000, 1500)).toBe(0);
    expect(percentSaved(0, 10)).toBe(0);
    expect(isSmaller(1000, 999)).toBe(true);
    expect(isSmaller(1000, 1000)).toBe(false);
    expect(isSmaller(1000, 1001)).toBe(false);
    expect(isSmaller(1000, 0)).toBe(false);
  });
  it('draws at the requested resolution, shrinking pages that would make an enormous canvas', () => {
    expect(renderScale(612, 792, 144)).toBeCloseTo(2);
    expect(renderScale(612, 792, 72)).toBeCloseTo(1);
    const huge = renderScale(5000, 7000, 200); // a poster
    expect(huge).toBeLessThan(200 / 72);
    expect(5000 * huge).toBeLessThanOrEqual(MAX_SIDE_PX + 1);
    expect(7000 * huge).toBeLessThanOrEqual(MAX_SIDE_PX + 1);
    expect(5000 * huge * 7000 * huge).toBeLessThanOrEqual(MAX_PIXELS * 1.001);
    expect(renderScale(0, 0, 144)).toBeCloseTo(2);
  });
  it('has presets that get smaller as they go', () => {
    expect(RASTER_PRESETS.small.dpi).toBeLessThan(RASTER_PRESETS.balanced.dpi);
    expect(RASTER_PRESETS.small.quality).toBeLessThan(RASTER_PRESETS.balanced.quality);
  });
});

describe('fixtures', () => {
  it('makePdf is a valid document (sanity)', async () => {
    expect((await PDFDocument.load(await makePdf(2))).getPageCount()).toBe(2);
  });
});
