/**
 * Compress PDF, the pdf-lib half (runs in the worker).
 *
 * `optimizePdf` is the *lossless* clean-up: it keeps every page, link, form field and bookmark and only removes waste —
 *  1. objects nothing refers to any more (old revisions from "incremental saves", deleted pages' leftovers…),
 *  2. uncompressed streams get Flate-compressed (only kept when that makes them smaller),
 *  3. the file is rewritten with object streams, which packs the many small objects together.
 *
 * `rebuildFromJpegs` is the second half of Balanced / Small: the pages were already drawn to JPEGs on the main thread
 * (pdf.js needs a canvas); here they are laid onto pages of the original size. The result looks the same but is a
 * picture — the caller says so in the UI.
 */
import { PDFArray, type PDFContext, PDFDict, PDFDocument, PDFName, type PDFObject, PDFRawStream, PDFRef, PDFStream } from 'pdf-lib';
import { PdfError } from './errors';
import { checkpoint, type JobContext } from './job';
import { loadPdf, SAVE_OPTIONS } from './ops';
import type { RasterPage } from './types';

const FILTER = PDFName.of('Filter');
const FLATE = PDFName.of('FlateDecode');
const TYPE = PDFName.of('Type');
/** Streams smaller than this aren't worth a zlib header, and tiny ones often *grow*. */
const MIN_STREAM_BYTES = 256;

/** Every indirect object reachable from the document's root (and info) — what a reader could ever get to. */
export function reachableRefs(context: PDFContext): Set<string> {
  const seen = new Set<string>();
  const stack: PDFObject[] = [];
  const push = (o: PDFObject | undefined) => o && stack.push(o);
  push(context.trailerInfo.Root);
  push(context.trailerInfo.Info);
  push(context.trailerInfo.Encrypt);

  while (stack.length > 0) {
    const obj = stack.pop();
    if (obj instanceof PDFRef) {
      if (seen.has(obj.tag)) continue;
      seen.add(obj.tag);
      push(context.lookup(obj));
    } else if (obj instanceof PDFStream) {
      for (const [, v] of obj.dict.entries()) stack.push(v);
    } else if (obj instanceof PDFDict) {
      for (const [, v] of obj.entries()) stack.push(v);
    } else if (obj instanceof PDFArray) {
      for (const v of obj.asArray()) stack.push(v);
    }
  }
  return seen;
}

/** Delete indirect objects nothing refers to. Returns how many were dropped. */
export function dropUnreferenced(context: PDFContext): number {
  const live = reachableRefs(context);
  let dropped = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!live.has(ref.tag)) {
      context.delete(ref);
      dropped++;
    }
  }
  return dropped;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate'); // zlib-wrapped, which is exactly what /FlateDecode expects
  const writer = stream.writable.getWriter();
  void writer.write(data as Uint8Array<ArrayBuffer>);
  void writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** Flate-compress streams that have no filter at all. Returns how many shrank. */
export async function deflateRawStreams(context: PDFContext, ctx?: JobContext): Promise<number> {
  if (typeof CompressionStream === 'undefined' || typeof Response === 'undefined') return 0;
  const candidates = context.enumerateIndirectObjects().filter(([, obj]) => {
    if (!(obj instanceof PDFRawStream) || obj.contents.length < MIN_STREAM_BYTES) return false;
    if (obj.dict.has(FILTER)) return false;
    const type = obj.dict.lookup(TYPE);
    return !(type instanceof PDFName && (type.asString() === '/Metadata' || type.asString() === '/XRef' || type.asString() === '/ObjStm'));
  });

  let shrank = 0;
  for (const [n, [ref, obj]] of candidates.entries()) {
    if (n % 16 === 0) await checkpoint(ctx, 1 + n / Math.max(1, candidates.length), 3, 'Compressing streams');
    const raw = obj as PDFRawStream;
    const packed = await deflate(raw.contents);
    if (packed.length >= raw.contents.length) continue;
    const dict = raw.dict.clone(context);
    dict.set(FILTER, FLATE);
    context.assign(ref, PDFRawStream.of(dict, packed));
    shrank++;
  }
  return shrank;
}

/** Lossless clean-up (see the file header). */
export async function optimizePdf(bytes: Uint8Array, ctx?: JobContext): Promise<Uint8Array> {
  await checkpoint(ctx, 0, 3, 'Reading the PDF');
  const doc = await loadPdf(bytes);
  await checkpoint(ctx, 0.5, 3, 'Removing unused data');
  dropUnreferenced(doc.context);
  await deflateRawStreams(doc.context, ctx);
  await checkpoint(ctx, 2, 3, 'Saving');
  return doc.save({ ...SAVE_OPTIONS, useObjectStreams: true });
}

/** Lay already-drawn JPEG pages onto pages of the stated size. */
export async function rebuildFromJpegs(pages: readonly RasterPage[], ctx?: JobContext): Promise<Uint8Array> {
  if (pages.length === 0) throw new PdfError('There are no pages to rebuild.');
  const doc = await PDFDocument.create();
  for (const [n, p] of pages.entries()) {
    await checkpoint(ctx, n, pages.length + 1, `Building page ${n + 1} of ${pages.length}`);
    const img = await doc.embedJpg(p.jpeg);
    const page = doc.addPage([p.width, p.height]);
    page.drawImage(img, { x: 0, y: 0, width: p.width, height: p.height });
  }
  await checkpoint(ctx, pages.length, pages.length + 1, 'Saving');
  return doc.save(SAVE_OPTIONS);
}
