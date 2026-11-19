/** Test-only helpers: build small PDFs with known contents. Never imported by app code. */
import {
  decodePDFRawStream,
  degrees,
  drawObject,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
} from 'pdf-lib';

/** A real 1×1 PNG. */
export const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='), (c) =>
  c.charCodeAt(0),
);

/** A real 1×1 JPEG. */
export const JPEG = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  ),
  (c) => c.charCodeAt(0),
);

/** A PDF whose page i is (100 + i*10) wide and 200 tall, so pages can be told apart by size. */
export async function makePdf(pages: number, rotations: number[] = []): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([100 + i * 10, 200]);
    if (rotations[i]) p.setRotation(degrees(rotations[i] as number));
  }
  return doc.save();
}

/** Incompressible bytes, so a copy of them is easy to spot in a file size. */
export function noise(length: number): Uint8Array {
  const data = new Uint8Array(length);
  let x = 123456789;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    data[i] = x & 255;
  }
  return data;
}

/**
 * `pages` pages that all draw the same big image and use the same font — like a scanned report or slides with a logo.
 * `imageBytes` is the size of that one shared image.
 */
export async function makeSharedPdf(pages: number, imageBytes = 200_000): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const side = Math.floor(Math.sqrt(imageBytes));
  const image = doc.context.register(
    doc.context.stream(noise(side * side), { Type: 'XObject', Subtype: 'Image', Width: side, Height: side, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }),
  );
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([300, 300]);
    page.drawText(`page ${i + 1}`, { x: 20, y: 20, font, size: 12, color: rgb(0, 0, 0) });
    page.pushOperators(pushGraphicsState(), drawObject(page.node.newXObject('Im0', image)), popGraphicsState());
  }
  return doc.save();
}

/** Page 1 carries a "go to page N" link (an internal destination) next to a web link. */
export async function makeLinkedPdf(pages: number, imageBytes = 150_000): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const side = Math.floor(Math.sqrt(imageBytes));
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([300, 300]);
    // Each page has its own big image, so a page dragged along as an orphan is easy to see in the file size.
    const image = doc.context.register(
      doc.context.stream(noise(side * side), { Type: 'XObject', Subtype: 'Image', Width: side, Height: side, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }),
    );
    page.pushOperators(pushGraphicsState(), drawObject(page.node.newXObject('Im0', image)), popGraphicsState());
  }
  const first = doc.getPage(0);
  const last = doc.getPage(pages - 1);
  const goTo = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 20], Border: [0, 0, 0], Dest: [last.ref, 'Fit'] });
  const web = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [60, 0, 110, 20],
    Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: 'https://example.com' },
  });
  first.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(goTo), doc.context.register(web)]));
  return doc.save();
}

export const widths = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth());

/** How many annotations page `index` has, and how many of them have a `/Dest` or a GoTo action. */
export async function annotationSummary(bytes: Uint8Array, index: number): Promise<{ total: number; internal: number; uris: number }> {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(index).node.Annots();
  let internal = 0;
  let uris = 0;
  for (let i = 0; annots && i < annots.size(); i++) {
    const a = doc.context.lookup(annots.get(i), PDFDict);
    if (a.has(PDFName.of('Dest'))) internal++;
    const action = a.lookupMaybe(PDFName.of('A'), PDFDict);
    if (action?.has(PDFName.of('URI'))) uris++;
  }
  return { total: annots instanceof PDFArray ? annots.size() : 0, internal, uris };
}

/** The page's content, decoded, as text (operators are ASCII). */
export async function pageContent(bytes: Uint8Array, index: number): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(index).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  return streams
    .map((st) => {
      if (st instanceof PDFRawStream) return new TextDecoder('latin1').decode(decodePDFRawStream(st).decode());
      if (st instanceof PDFStream) return new TextDecoder('latin1').decode((st as unknown as { getUnencodedContents(): Uint8Array }).getUnencodedContents());
      return '';
    })
    .join('\n');
}

/** Every `a b c d e f cm` in the content, as numbers. */
export function matrices(content: string): number[][] {
  return [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm/g)].map((m) => m.slice(1, 7).map(Number));
}

/**
 * Size and turn of the last image drawn on the page, from the transformation matrices around its `Do`
 * (the CTM is the product of every `cm` since the enclosing `q`).
 */
export function lastImageBox(content: string): { width: number; height: number; angle: number } {
  const doAt = content.lastIndexOf(' Do');
  const block = content.slice(content.lastIndexOf('q', doAt), doAt);
  let ctm = [1, 0, 0, 1, 0, 0];
  for (const m of matrices(block)) {
    const [a1, b1, c1, d1, e1, f1] = m as [number, number, number, number, number, number];
    const [a2, b2, c2, d2, e2, f2] = ctm as [number, number, number, number, number, number];
    ctm = [a1 * a2 + b1 * c2, a1 * b2 + b1 * d2, c1 * a2 + d1 * c2, c1 * b2 + d1 * d2, e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2];
  }
  const [a, b, c, d] = ctm as [number, number, number, number];
  return { width: Math.hypot(a, b), height: Math.hypot(c, d), angle: (Math.atan2(b, a) * 180) / Math.PI };
}
