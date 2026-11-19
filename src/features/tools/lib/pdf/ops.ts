/**
 * PDF operations, all on-device (pdf-lib). Pure functions over bytes → bytes so they're easy to test. They run inside a
 * Web Worker (see `pdf/client.ts`); the optional `ctx` is how they report progress and notice a cancel.
 */
import { degrees, PageSizes, PDFDocument, type PDFImage } from 'pdf-lib';
import { PageCopier } from './copy';
import { PdfError } from './errors';
import { type FRect, fitAspect, fractionAspect, normalizeRotation, placeUpright, type Rotation, visualSize, visualToUser } from './geometry';
import { checkpoint, type JobContext } from './job';
import type { ImageInput, ImagesToPdfOptions, PageRef, SignaturePlacement } from './types';

export { PdfError } from './errors';
export type { ImageInput, ImagePageSize, ImagesToPdfOptions, PageRef, SignaturePlacement } from './types';

/**
 * pdf-lib yields to the event loop every N objects while loading (`parseSpeed`, default 100) and saving
 * (`objectsPerTick`, default 50). That is a `setTimeout(0)` — clamped to ~4 ms — so a 100 000-object file spent seconds
 * just waiting. Thousands per tick keeps the pauses (needed so the main-thread fallback stays responsive) without the
 * dead time.
 */
export const OBJECTS_PER_TICK = 2000;
export const SAVE_OPTIONS = { objectsPerTick: OBJECTS_PER_TICK } as const;

/** Load a PDF, turning pdf-lib's failures into messages a person can act on. */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false, parseSpeed: OBJECTS_PER_TICK });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/encrypt/i.test(msg)) throw new PdfError('This PDF is password-protected. Remove the password first, then try again.');
    throw new PdfError('That file doesn’t look like a valid PDF.');
  }
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await loadPdf(bytes)).getPageCount();
}

/** Build a new PDF from pages of one or more PDFs, in the order given. This is reorder, delete, rotate and extract in one. */
export async function assemble(sources: Uint8Array[], pages: PageRef[], ctx?: JobContext): Promise<Uint8Array> {
  if (pages.length === 0) throw new PdfError('Choose at least one page.');
  // Only the files that contribute a page are read — extracting from one of five open files shouldn't parse all five.
  const used = [...new Set(pages.map((p) => p.source))];
  if (used.some((s) => !sources[s])) throw new PdfError('A selected page doesn’t exist in its file.');
  const total = used.length + pages.length + 1;

  const out = await PDFDocument.create();
  const copiers = new Map<number, { doc: PDFDocument; copier: PageCopier }>();
  for (const [n, s] of used.entries()) {
    await checkpoint(ctx, n, total, used.length > 1 ? `Reading file ${n + 1} of ${used.length}` : 'Reading the PDF');
    const doc = await loadPdf(sources[s] as Uint8Array);
    copiers.set(s, { doc, copier: new PageCopier(doc, out) });
  }

  for (const [n, ref] of pages.entries()) {
    await checkpoint(ctx, used.length + n, total, `Copying page ${n + 1} of ${pages.length}`);
    const src = copiers.get(ref.source);
    if (!src || !Number.isInteger(ref.page) || ref.page < 0 || ref.page >= src.doc.getPageCount())
      throw new PdfError('A selected page doesn’t exist in its file.');
    const copied = src.copier.copy(ref.page);
    const turn = normalizeRotation(ref.rotate);
    if (turn !== 0) copied.setRotation(degrees(normalizeRotation(copied.getRotation().angle + turn)));
    out.addPage(copied);
  }
  copiers.clear();
  await checkpoint(ctx, total - 1, total, 'Saving');
  return out.save(SAVE_OPTIONS);
}

/** Append whole PDFs one after another. Each file is read once and released before the next is opened. */
export async function mergePdfs(files: Uint8Array[], ctx?: JobContext): Promise<Uint8Array> {
  if (files.length < 2) throw new PdfError('Add at least two PDFs to merge.');
  const total = files.length + 1;
  const out = await PDFDocument.create();
  for (const [n, bytes] of files.entries()) {
    await checkpoint(ctx, n, total, `Merging file ${n + 1} of ${files.length}`);
    const doc = await loadPdf(bytes);
    const copier = new PageCopier(doc, out);
    const count = doc.getPageCount();
    for (let p = 0; p < count; p++) {
      out.addPage(copier.copy(p));
      if (p % 8 === 7) await checkpoint(ctx, n + (p + 1) / count, total, `Merging file ${n + 1} of ${files.length}`);
    }
  }
  await checkpoint(ctx, total - 1, total, 'Saving');
  return out.save(SAVE_OPTIONS);
}

/** Crop pages to visible rectangles (fractions of the page as displayed). `null` leaves a page alone. */
export async function cropPdf(bytes: Uint8Array, crops: Array<FRect | null>, ctx?: JobContext): Promise<Uint8Array> {
  await checkpoint(ctx, 0, 1, 'Reading the PDF');
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  for (const [i, page] of pages.entries()) {
    const r = crops[i];
    if (!r) continue;
    if (i % 8 === 0) await checkpoint(ctx, i, pages.length + 1, `Cropping page ${i + 1} of ${pages.length}`);
    const visible = page.getCropBox();
    const box = visualToUser(visible, normalizeRotation(page.getRotation().angle), r);
    if (box.width < 1 || box.height < 1) throw new PdfError(`The crop on page ${i + 1} is too small.`);
    // Set both: viewers honour CropBox, but some tools (and print paths) use MediaBox.
    page.setCropBox(box.x, box.y, box.width, box.height);
    page.setMediaBox(box.x, box.y, box.width, box.height);
  }
  await checkpoint(ctx, pages.length, pages.length + 1, 'Saving');
  return doc.save(SAVE_OPTIONS);
}

/** One image per page. `fit` makes each page exactly as big as its image (at 96 dpi); A4/Letter centre it with a margin. */
export async function imagesToPdf(images: ImageInput[], opts: ImagesToPdfOptions, ctx?: JobContext): Promise<Uint8Array> {
  if (images.length === 0) throw new PdfError('Add at least one image.');
  const doc = await PDFDocument.create();
  for (const [n, input] of images.entries()) {
    await checkpoint(ctx, n, images.length + 1, `Adding image ${n + 1} of ${images.length}`);
    const img = input.kind === 'png' ? await doc.embedPng(input.bytes) : await doc.embedJpg(input.bytes);
    const margin = Math.max(0, opts.margin);
    if (opts.size === 'fit') {
      const w = img.width * 0.75;
      const h = img.height * 0.75;
      const page = doc.addPage([w + margin * 2, h + margin * 2]);
      page.drawImage(img, { x: margin, y: margin, width: w, height: h });
      continue;
    }
    const base = opts.size === 'a4' ? PageSizes.A4 : PageSizes.Letter;
    const landscape = opts.orientation === 'landscape' || (opts.orientation === 'auto' && img.width > img.height);
    const [pw, ph] = landscape ? [base[1], base[0]] : [base[0], base[1]];
    const page = doc.addPage([pw, ph]);
    const scale = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  await checkpoint(ctx, images.length, images.length + 1, 'Saving');
  return doc.save(SAVE_OPTIONS);
}

/** Stamp signature images (transparent PNGs) onto pages, placed in what the viewer sees — so it's upright on rotated pages too. */
export async function signPdf(bytes: Uint8Array, placements: SignaturePlacement[], ctx?: JobContext): Promise<Uint8Array> {
  if (placements.length === 0) throw new PdfError('Place a signature on a page first.');
  await checkpoint(ctx, 0, placements.length + 1, 'Reading the PDF');
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const cache = new Map<Uint8Array, PDFImage>();
  for (const [n, p] of placements.entries()) {
    await checkpoint(ctx, n, placements.length + 1, `Placing signature ${n + 1} of ${placements.length}`);
    const page = pages[p.page];
    if (!page) throw new PdfError('A signature points at a page that doesn’t exist.');
    let img = cache.get(p.png);
    if (!img) {
      img = await doc.embedPng(p.png);
      cache.set(p.png, img);
    }
    const rotation: Rotation = normalizeRotation(page.getRotation().angle);
    const box = page.getCropBox();
    const vis = visualSize(box, rotation);
    // The rectangle was drawn on a page that may not have this page's proportions ("every page"): keep the picture's own
    // shape instead of stretching it.
    const rect = fitAspect(p.rect, fractionAspect(img.width / img.height, vis.height / vis.width));
    const at = placeUpright(box, rotation, rect);
    page.drawImage(img, { x: at.x, y: at.y, width: at.width, height: at.height, rotate: degrees(at.angle) });
  }
  await checkpoint(ctx, placements.length, placements.length + 1, 'Saving');
  return doc.save(SAVE_OPTIONS);
}
