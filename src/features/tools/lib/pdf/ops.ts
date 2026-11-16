/**
 * PDF operations, all on-device (pdf-lib). Pure functions over bytes → bytes so they're easy to test.
 */
import { degrees, PageSizes, PDFDocument } from 'pdf-lib';
import { type FRect, normalizeRotation, placeUpright, type Rotation, visualToUser } from './geometry';

export class PdfError extends Error {}

/** Load a PDF, turning pdf-lib's failures into messages a person can act on. */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (/encrypt/i.test(msg)) throw new PdfError('This PDF is password-protected. Remove the password first, then try again.');
    throw new PdfError('That file doesn’t look like a valid PDF.');
  }
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await loadPdf(bytes)).getPageCount();
}

/** One output page: which source file, which of its pages (0-based), and how much to turn it on top of its own rotation. */
export type PageRef = { source: number; page: number; rotate: number };

/** Build a new PDF from pages of one or more PDFs, in the order given. This is merge, reorder, delete, rotate and extract in one. */
export async function assemble(sources: Uint8Array[], pages: PageRef[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new PdfError('Choose at least one page.');
  const docs = await Promise.all(sources.map(loadPdf));
  const out = await PDFDocument.create();
  for (const ref of pages) {
    const src = docs[ref.source];
    if (!src || ref.page < 0 || ref.page >= src.getPageCount()) throw new PdfError('A selected page doesn’t exist in its file.');
    const [copied] = await out.copyPages(src, [ref.page]);
    if (!copied) throw new PdfError('Couldn’t copy a page.');
    const turn = normalizeRotation(ref.rotate);
    if (turn !== 0) copied.setRotation(degrees(normalizeRotation(copied.getRotation().angle + turn)));
    out.addPage(copied);
  }
  return out.save();
}

/** Append whole PDFs one after another. */
export async function mergePdfs(files: Uint8Array[]): Promise<Uint8Array> {
  if (files.length < 2) throw new PdfError('Add at least two PDFs to merge.');
  const counts = await Promise.all(files.map(pageCount));
  const pages: PageRef[] = counts.flatMap((n, source) => Array.from({ length: n }, (_, page) => ({ source, page, rotate: 0 })));
  return assemble(files, pages);
}

/** Crop pages to visible rectangles (fractions of the page as displayed). `null` leaves a page alone. */
export async function cropPdf(bytes: Uint8Array, crops: Array<FRect | null>): Promise<Uint8Array> {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    const r = crops[i];
    if (!r) return;
    const visible = page.getCropBox();
    const box = visualToUser(visible, normalizeRotation(page.getRotation().angle), r);
    if (box.width < 1 || box.height < 1) throw new PdfError(`The crop on page ${i + 1} is too small.`);
    // Set both: viewers honour CropBox, but some tools (and print paths) use MediaBox.
    page.setCropBox(box.x, box.y, box.width, box.height);
    page.setMediaBox(box.x, box.y, box.width, box.height);
  });
  return doc.save();
}

export type ImageInput = { bytes: Uint8Array; kind: 'jpg' | 'png' };
export type ImagePageSize = 'fit' | 'a4' | 'letter';
export type ImagesToPdfOptions = { size: ImagePageSize /** points */; margin: number; orientation: 'auto' | 'portrait' | 'landscape' };

/** One image per page. `fit` makes each page exactly as big as its image (at 96 dpi); A4/Letter centre it with a margin. */
export async function imagesToPdf(images: ImageInput[], opts: ImagesToPdfOptions): Promise<Uint8Array> {
  if (images.length === 0) throw new PdfError('Add at least one image.');
  const doc = await PDFDocument.create();
  for (const input of images) {
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
  return doc.save();
}

export type SignaturePlacement = { page: number; rect: FRect; png: Uint8Array };

/** Stamp signature images (transparent PNGs) onto pages, placed in what the viewer sees — so it's upright on rotated pages too. */
export async function signPdf(bytes: Uint8Array, placements: SignaturePlacement[]): Promise<Uint8Array> {
  if (placements.length === 0) throw new PdfError('Place a signature on a page first.');
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  const cache = new Map<Uint8Array, Awaited<ReturnType<PDFDocument['embedPng']>>>();
  for (const p of placements) {
    const page = pages[p.page];
    if (!page) throw new PdfError('A signature points at a page that doesn’t exist.');
    let img = cache.get(p.png);
    if (!img) {
      img = await doc.embedPng(p.png);
      cache.set(p.png, img);
    }
    const rotation: Rotation = normalizeRotation(page.getRotation().angle);
    const at = placeUpright(page.getCropBox(), rotation, p.rect);
    page.drawImage(img, { x: at.x, y: at.y, width: at.width, height: at.height, rotate: degrees(at.angle) });
  }
  return doc.save();
}
