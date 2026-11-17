/**
 * Copying pages between PDFs without bloating the result.
 *
 * Why this exists: `PDFDocument.copyPages` makes a fresh object copier on every call, and a copier is what remembers
 * "I already copied this font / image / colour profile". The first version of Merge called it once per page, so a font
 * or scan shared by 40 pages was written 40 times — two 400 KB files merged to 16 MB. One `PageCopier` per source
 * document keeps that memory for the whole copy, so every shared resource lands in the output once.
 *
 * Link annotations are the other way a page drags the rest of its document along: a link to "page 7" holds a
 * reference to that page, and copying it copies page 7 (content, images, fonts) as an orphan nobody can reach — and
 * the link wouldn't work anyway, because it points at the orphan rather than at a page of the new file. Links to
 * places inside the source file are therefore dropped before copying; links to web addresses are kept.
 */
import { PDFDict, type PDFDocument, PDFName, PDFObjectCopier, PDFPage } from 'pdf-lib';

const LINK = PDFName.of('Link');
const SUBTYPE = PDFName.of('Subtype');
const GOTO = PDFName.of('GoTo');

/** True for a link annotation that jumps to somewhere inside its own document. */
function isInternalLink(annot: PDFDict): boolean {
  if (annot.lookup(SUBTYPE) !== LINK) return false;
  if (annot.has(PDFName.of('Dest'))) return true;
  const action = annot.lookupMaybe(PDFName.of('A'), PDFDict);
  return action?.lookup(PDFName.of('S')) === GOTO;
}

/** Remove what would pull other pages into a copy: internal links, and the `/P` back-reference every annotation may carry. */
export function pruneAnnotations(page: PDFPage): void {
  const annots = page.node.Annots();
  if (!annots) return;
  for (let i = annots.size() - 1; i >= 0; i--) {
    const annot = page.doc.context.lookupMaybe(annots.get(i), PDFDict);
    if (!annot) continue;
    annot.delete(PDFName.of('P'));
    if (isInternalLink(annot)) annots.remove(i);
  }
}

/** Copies pages of one source document into `dest`. Use one instance per (source, destination) pair, for as long as you copy. */
export class PageCopier {
  private readonly copier: PDFObjectCopier;
  private readonly pruned = new Set<number>();

  constructor(
    private readonly src: PDFDocument,
    private readonly dest: PDFDocument,
  ) {
    this.copier = PDFObjectCopier.for(src.context, dest.context);
  }

  /** Copy page `index` (0-based) of the source. Returns a page that is NOT yet in the destination's page tree. */
  copy(index: number): PDFPage {
    const source = this.src.getPage(index);
    if (!this.pruned.has(index)) {
      pruneAnnotations(source);
      this.pruned.add(index);
    }
    const node = this.copier.copy(source.node);
    return PDFPage.of(node, this.dest.context.register(node), this.dest);
  }
}
