/** Watermark PDF, the pdf-lib half (runs in the worker). Layout comes from `watermarkLayout.ts`, shared with the live preview. */
import {
  beginText,
  endText,
  PDFDocument,
  type PDFFont,
  popGraphicsState,
  pushGraphicsState,
  rotateAndSkewTextRadiansAndTranslate,
  StandardFonts,
  setFillingRgbColor,
  setFontAndSize,
  setGraphicsState,
  showText,
} from 'pdf-lib';
import { PdfError } from './errors';
import { normalizeRotation, pointToUser, visualSize } from './geometry';
import { checkpoint, type JobContext } from './job';
import { loadPdf, SAVE_OPTIONS } from './ops';
import type { WatermarkOptions } from './types';
import {
  CAP_HEIGHT,
  cleanText,
  type FontMetrics,
  type FontWidths,
  layoutStamps,
  MAX_SIZE,
  MAX_TEXT_LENGTH,
  MIN_SIZE,
  parseHexColor,
  textWidth,
  unsupportedChars,
} from './watermarkLayout';

function widthsOf(font: PDFFont): FontWidths {
  const table: FontWidths = {};
  for (const codePoint of font.getCharacterSet()) {
    const ch = String.fromCodePoint(codePoint);
    table[ch] = font.widthOfTextAtSize(ch, 1);
  }
  return table;
}

/** Per-character widths of the two fonts the tool offers (Helvetica and Helvetica Bold), so the UI can lay text out without pdf-lib. */
export async function measureFonts(): Promise<FontMetrics> {
  const doc = await PDFDocument.create();
  const [regular, bold] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
  return { regular: widthsOf(regular), bold: widthsOf(bold) };
}

const toRadians = (deg: number) => (deg * Math.PI) / 180;

/** Stamp the text on the chosen pages (all by default). One graphics state and one text object per page, however many tiles. */
export async function watermarkPdf(bytes: Uint8Array, opts: WatermarkOptions, ctx?: JobContext): Promise<Uint8Array> {
  const text = cleanText(opts.text);
  if (!text) throw new PdfError('Type the text for the watermark.');
  if (text.length > MAX_TEXT_LENGTH) throw new PdfError(`Keep the watermark under ${MAX_TEXT_LENGTH} characters.`);
  if (!(opts.size >= MIN_SIZE && opts.size <= MAX_SIZE)) throw new PdfError(`Choose a font size between ${MIN_SIZE} and ${MAX_SIZE}.`);

  await checkpoint(ctx, 0, 1, 'Reading the PDF');
  const doc = await loadPdf(bytes);
  const font = await doc.embedFont(opts.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  const widths = widthsOf(font);
  const missing = unsupportedChars(text, widths);
  if (missing.length > 0) {
    throw new PdfError(`PDF’s built-in fonts can’t draw ${missing.map((c) => `“${c}”`).join(' ')}. Stick to letters, numbers and common punctuation.`);
  }

  const pages = doc.getPages();
  const targets = opts.pages ?? pages.map((_, i) => i);
  if (targets.length === 0 || targets.some((i) => !Number.isInteger(i) || i < 0 || i >= pages.length))
    throw new PdfError('Choose pages that exist in this PDF.');

  const w = textWidth(text, opts.size, widths);
  const h = opts.size * CAP_HEIGHT;
  const { r, g, b } = parseHexColor(opts.color);
  const opacity = Math.min(1, Math.max(0, opts.opacity));
  const encoded = font.encodeText(text);
  const gsRef = doc.context.register(doc.context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity }));

  for (const [n, index] of targets.entries()) {
    await checkpoint(ctx, 1 + n, targets.length + 2, `Stamping page ${index + 1} (${n + 1} of ${targets.length})`);
    const page = pages[index];
    if (!page) continue;
    const rotation = normalizeRotation(page.getRotation().angle);
    const box = page.getCropBox();
    const vis = visualSize(box, rotation);
    const stamps = layoutStamps(vis, w, h, { rotation: opts.rotation, layout: opts.layout, position: opts.position });

    const gs = page.node.newExtGState('WM', gsRef);
    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    const ops = [pushGraphicsState(), setGraphicsState(gs), setFillingRgbColor(r, g, b), beginText(), setFontAndSize(fontKey, opts.size)];
    for (const s of stamps) {
      // The layout is in what the viewer sees; map the text origin into the page's own space, turning the text with the page.
      const at = pointToUser(box, rotation, s.x / vis.width, 1 - s.y / vis.height);
      ops.push(rotateAndSkewTextRadiansAndTranslate(toRadians(s.angle + rotation), 0, 0, at.x, at.y), showText(encoded));
    }
    ops.push(endText(), popGraphicsState());
    page.pushOperators(...ops);
  }
  await checkpoint(ctx, targets.length + 1, targets.length + 2, 'Saving');
  return doc.save(SAVE_OPTIONS);
}
