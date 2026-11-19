// Renders the PDF tools in happy-dom and drives them like a person would. The PDF engine runs for real (on the "main thread"
// fallback, which is what happens when no Worker exists); only pdf.js (page drawing), downloads and toasts are replaced.

import { PDFDocument } from 'pdf-lib';
import { act, type ComponentType, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui';
import { makePdf, makeSharedPdf } from '@/features/tools/lib/pdf/fixtures';
import { pdfRunner } from '@/features/tools/pdf/pdfRunner';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const downloads: Array<{ name: string; blob: Blob }> = [];
vi.mock('@/lib/download', () => ({
  downloadBlob: (name: string, blob: Blob) => downloads.push({ name, blob }),
  downloadText: () => {},
}));
vi.mock('@/lib/toast', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), action: vi.fn(), undo: vi.fn() },
}));

const opened: Array<{ numPages: number; closed: boolean }> = [];
vi.mock('@/features/tools/pdf/render', () => ({
  openPdf: vi.fn(async () => {
    const doc = { numPages: 3, closed: false };
    opened.push(doc);
    return doc;
  }),
  closePdf: vi.fn(async (doc: { closed: boolean }) => {
    doc.closed = true;
  }),
  pageSize: vi.fn(async () => ({ width: 600, height: 800 })),
  renderPage: vi.fn(async () => 800),
  rasterizePage: vi.fn(async (_doc: unknown, _index: number, _settings: unknown, signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException('Canceled', 'AbortError');
    return {
      jpeg: Uint8Array.from(
        atob(
          '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
        ),
        (c) => c.charCodeAt(0),
      ),
      width: 300,
      height: 300,
    };
  }),
}));

const { notify } = await import('@/lib/toast');
const render = await import('@/features/tools/pdf/render');

/** Narrow `T | undefined` or fail the test with a clear message (instead of a non-null assertion). */
function only<T>(value: T | undefined, what = 'value'): T {
  if (value === undefined) throw new Error(`Expected ${what} to exist`);
  return value;
}
const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, label: string) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await act(async () => void (await sleep(10)));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

describe('PDF tools (UI)', () => {
  let host: HTMLDivElement;
  let root: Root;

  const mount = async (tool: ComponentType) => {
    await act(async () => {
      root.render(createElement(TooltipProvider, null, createElement(tool)));
    });
  };
  const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);
  const button = (name: RegExp | string) =>
    [...host.querySelectorAll('button')].find((b) => {
      const label = (b.textContent ?? '').trim();
      return typeof name === 'string' ? label === name : name.test(label) || name.test(b.getAttribute('aria-label') ?? '');
    });
  const click = (el: Element | undefined | null) => act(async () => void el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  const typeInto = (el: HTMLInputElement | null | undefined, value: string) =>
    act(async () => {
      if (!el) throw new Error('no input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const pick = async (...files: Array<{ name: string; bytes: Uint8Array }>) => {
    const input = $<HTMLInputElement>('input[type=file]');
    if (!input) throw new Error('no file input');
    Object.defineProperty(input, 'files', {
      value: files.map((f) => new File([f.bytes as BlobPart], f.name, { type: 'application/pdf' })),
      configurable: true,
    });
    await act(async () => void input.dispatchEvent(new Event('change', { bubbles: true })));
  };
  const text = () => host.textContent ?? '';

  beforeEach(() => {
    downloads.length = 0;
    opened.length = 0;
    vi.mocked(notify.success).mockClear();
    vi.mocked(notify.error).mockClear();
    vi.mocked(notify.info).mockClear();
    if (!('IntersectionObserver' in globalThis)) {
      (globalThis as Record<string, unknown>).IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('runs on the main thread when there is no Worker', async () => {
    await mount((await import('./PdfSplitTool')).default);
    await pick({ name: 'book.pdf', bytes: await makePdf(5) });
    await until(() => text().includes('5 pages'), 'file loaded');
    expect(pdfRunner.usingFallback).toBe(true);
  });

  describe('Split PDF', () => {
    it('validates ranges live, splits, and offers each file and a zip', async () => {
      await mount((await import('./PdfSplitTool')).default);
      await pick({ name: 'book.pdf', bytes: await makePdf(12) });
      await until(() => text().includes('12 pages'), 'file loaded');

      const input = $<HTMLInputElement>('input[aria-label="Page ranges"]');
      expect(button(/^Split/)?.hasAttribute('disabled')).toBe(true);

      await typeInto(input, '1-3, 99');
      expect(text()).toContain('Page 99 doesn’t exist — this PDF has 12 pages.');
      expect($('input[aria-label="Page ranges"]')?.getAttribute('aria-invalid')).toBe('true');
      expect(button(/^Split/)?.hasAttribute('disabled')).toBe(true);

      await typeInto(input, '1-3, 5, 8-');
      expect(text()).toContain('3 files · 9 of 12 pages used, 3 left out');
      expect(text()).toContain('book-pages-01-03.pdf');
      expect(text()).toContain('book-page-05.pdf');
      expect(text()).toContain('book-pages-08-12.pdf');

      await click(button('Split into 3 files'));
      await until(() => text().includes('3 files ready'), 'split finished');
      expect(notify.success).toHaveBeenCalledWith('Split done', expect.stringContaining('3 files'));

      // One file on its own…
      await click(button(/^Download book-page-05\.pdf$/));
      expect(downloads.at(-1)?.name).toBe('book-page-05.pdf');
      expect((await PDFDocument.load(new Uint8Array(await only(downloads.at(-1), 'a download').blob.arrayBuffer()))).getPageCount()).toBe(1);

      // …and all of them in a zip.
      await click(button(/Download all/));
      const zip = downloads.at(-1);
      expect(zip?.name).toBe('book-split.zip');
      const bytes = new Uint8Array(await only(zip, 'the zip').blob.arrayBuffer());
      expect(new TextDecoder('latin1').decode(bytes)).toContain('book-pages-08-12.pdf');
      expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);

      // Changing the ranges hides results that no longer match.
      await typeInto($<HTMLInputElement>('input[aria-label="Page ranges"]'), '1-2');
      expect(text()).not.toContain('3 files ready');
    });

    it('every N pages and one file per page', async () => {
      await mount((await import('./PdfSplitTool')).default);
      await pick({ name: 'doc.pdf', bytes: await makePdf(7) });
      await until(() => text().includes('7 pages'), 'file loaded');
      await click(button('Every N pages'));
      await typeInto($<HTMLInputElement>('input[aria-label="Pages per file"]'), '3');
      expect(text()).toContain('3 files · 7 pages in all');
      await typeInto($<HTMLInputElement>('input[aria-label="Pages per file"]'), '0');
      expect(text()).toContain('Enter a whole number of pages');
      await click(button('Each page'));
      expect(text()).toContain('7 files · 7 pages in all');
      expect(button('Split into 7 files')).toBeTruthy();
    });
  });

  describe('Merge PDFs', () => {
    it('merges, with the output not inflated by shared resources', async () => {
      const shared = await makeSharedPdf(20);
      await mount((await import('./PdfMergeTool')).default);
      await pick({ name: 'a.pdf', bytes: shared }, { name: 'b.pdf', bytes: shared });
      await until(() => text().includes('2 files'), 'files loaded');
      await click(button(/^Merge/));
      await until(() => downloads.length === 1, 'merged');
      expect(downloads[0]?.name).toBe('a+b.pdf');
      expect(only(downloads[0], 'a download').blob.size).toBeLessThan(shared.length * 2 * 1.15);
    });

    it('shows progress with a Cancel that really cancels (and says nothing was saved)', async () => {
      let aborted = false;
      const run = vi.spyOn(pdfRunner, 'run').mockImplementation(async (job, opts) => {
        if (job.op === 'inspect') return { files: [], info: { pages: 2 } };
        opts?.onProgress?.({ done: 1, total: 4, label: 'Merging file 1 of 2' });
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(Object.assign(new Error('Canceled'), { name: 'AbortError' }));
          });
        });
      });
      await mount((await import('./PdfMergeTool')).default);
      await pick({ name: 'a.pdf', bytes: await makePdf(2) }, { name: 'b.pdf', bytes: await makePdf(2) });
      await until(() => text().includes('2 files'), 'files loaded');
      await click(button(/^Merge/));
      await until(() => $('[role=progressbar]') !== null, 'progress bar');
      expect(text()).toContain('Merging file 1 of 2');
      expect($('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('25');
      expect(button(/^Merge/)?.hasAttribute('disabled')).toBe(true);
      expect(document.activeElement?.textContent).toBe('Cancel'); // focus moves to Cancel, since the button that started the job is disabled

      await click(button('Cancel'));
      await until(() => $('[role=progressbar]') === null, 'progress bar gone');
      expect(aborted).toBe(true);
      expect(notify.info).toHaveBeenCalledWith('Canceled', 'Nothing was saved.');
      expect(notify.error).not.toHaveBeenCalled();
      expect(downloads).toHaveLength(0);
      expect(button(/^Merge/)?.hasAttribute('disabled')).toBe(false); // ready to go again
      run.mockRestore();
    });

    it('shows a failure with the tool’s own title', async () => {
      const run = vi.spyOn(pdfRunner, 'run').mockImplementation(async (job) => {
        if (job.op === 'inspect') return { files: [], info: { pages: 2 } };
        throw new Error('That file doesn’t look like a valid PDF.');
      });
      await mount((await import('./PdfMergeTool')).default);
      await pick({ name: 'a.pdf', bytes: await makePdf(2) }, { name: 'b.pdf', bytes: await makePdf(2) });
      await until(() => text().includes('2 files'), 'files loaded');
      await click(button(/^Merge/));
      await until(() => vi.mocked(notify.error).mock.calls.length > 0, 'error toast');
      expect(notify.error).toHaveBeenCalledWith('Couldn’t merge', 'That file doesn’t look like a valid PDF.');
      run.mockRestore();
    });
  });

  describe('Organize pages', () => {
    it('lets go of a file once all of its pages are deleted, and only sends the files that are still used', async () => {
      await mount((await import('./PdfPagesTool')).default);
      await pick({ name: 'a.pdf', bytes: await makePdf(3) }, { name: 'b.pdf', bytes: await makePdf(2) });
      await until(() => text().includes('5 pages'), 'files loaded');
      await until(() => opened.length === 2, 'pdf.js documents opened');
      // Select b.pdf's two pages (items 4 and 5) and delete them.
      await click(host.querySelector('button[aria-label^="Page 4"]'));
      await click(host.querySelector('button[aria-label^="Page 5"]'));
      await click(button(/^Delete$/));
      await until(() => text().includes('3 pages'), 'pages deleted');
      await until(() => opened.filter((d) => d.closed).length === 1, 'the unused file’s pdf.js document was released');

      const run = vi.spyOn(pdfRunner, 'run');
      await click(button(/Download 3 pages/));
      await until(() => downloads.length === 1, 'saved');
      const job = run.mock.calls.find(([j]) => j.op === 'assemble')?.[0];
      expect(job && 'sources' in job ? job.sources.length : -1).toBe(1);
      expect(downloads[0]?.name).toBe('a-edited.pdf');
      run.mockRestore();
    });

    it('extracting from one of several files sends only that file', async () => {
      await mount((await import('./PdfPagesTool')).default);
      await pick({ name: 'a.pdf', bytes: await makePdf(3) }, { name: 'b.pdf', bytes: await makePdf(2) });
      await until(() => text().includes('5 pages'), 'files loaded');
      await click(host.querySelector('button[aria-label^="Page 5"]'));
      const run = vi.spyOn(pdfRunner, 'run');
      await click(button(/Download selected \(1\)/));
      await until(() => downloads.length === 1, 'extracted');
      const job = run.mock.calls.find(([j]) => j.op === 'assemble')?.[0];
      expect(job && 'sources' in job ? job.sources.length : -1).toBe(1);
      expect(job && 'pages' in job ? job.pages : []).toEqual([{ source: 0, page: 1, rotate: 0 }]);
      expect(downloads[0]?.name).toBe('document-extract.pdf');
      run.mockRestore();
    });
  });

  describe('Compress PDF', () => {
    it('lossless: shows before/after and offers the file when it is smaller', async () => {
      // A document with plenty of waste: an object nothing refers to.
      const doc = await PDFDocument.create();
      doc.addPage([200, 200]);
      doc.context.register(
        doc.context.stream(
          new Uint8Array(200_000).map((_, i) => (i * 7919) & 255),
          { Junk: true },
        ),
      );
      const wasteful = await doc.save();

      await mount((await import('./PdfCompressTool')).default);
      await pick({ name: 'big.pdf', bytes: wasteful });
      await until(() => text().includes('1 page'), 'file loaded');
      await click(button('Clean up & compress'));
      await until(() => text().includes('% smaller'), 'result');
      expect(text()).toContain('Before');
      expect(text()).toContain('After');
      await click(button(/Download compressed PDF/));
      expect(downloads[0]?.name).toBe('big-compressed.pdf');
      expect(only(downloads[0], 'a download').blob.size).toBeLessThan(wasteful.length - 150_000);
    });

    it('never offers a result that is not smaller', async () => {
      await mount((await import('./PdfCompressTool')).default);
      await pick({ name: 'tiny.pdf', bytes: await makePdf(1) });
      await until(() => text().includes('1 page'), 'file loaded');
      await click(button('Clean up & compress'));
      await until(() => text().includes('already as small'), 'result');
      expect(button(/Download compressed/)).toBeUndefined();
      expect(downloads).toHaveLength(0);
    });

    it('Balanced / Smallest say plainly that they flatten the text, and rebuild from page pictures', async () => {
      const big = await makeSharedPdf(3, 300_000);
      await mount((await import('./PdfCompressTool')).default);
      await pick({ name: 'scan.pdf', bytes: big });
      await until(() => text().includes('3 pages'), 'file loaded');
      await click(button('Balanced'));
      expect(text()).toContain('This flattens the PDF.');
      expect(text()).toContain('text can no longer be selected');
      await until(() => opened.length > 0 && !button('Flatten & compress')?.hasAttribute('disabled'), 'preview ready');
      await click(button('Flatten & compress'));
      await until(() => text().includes('% smaller'), 'result');
      expect(text()).toContain('Text in this version can’t be selected.');
      await click(button(/Download compressed PDF/));
      const out = await PDFDocument.load(new Uint8Array(await only(downloads[0], 'a download').blob.arrayBuffer()));
      expect(out.getPageCount()).toBe(3);
      expect(out.getPage(0).getWidth()).toBe(300);
    });

    it('Cancel while pages are being drawn stops the drawing and keeps nothing', async () => {
      let seen: AbortSignal | undefined;
      vi.mocked(render.rasterizePage).mockImplementationOnce(
        (_doc, _index, _settings, signal) =>
          new Promise((_resolve, reject) => {
            seen = signal;
            // pdf.js rejects a canceled render with its own exception — not an AbortError.
            signal?.addEventListener('abort', () => reject(Object.assign(new Error('Rendering cancelled'), { name: 'RenderingCancelledException' })));
          }),
      );
      await mount((await import('./PdfCompressTool')).default);
      await pick({ name: 'scan.pdf', bytes: await makeSharedPdf(3, 300_000) });
      await until(() => text().includes('3 pages'), 'file loaded');
      await click(button('Smallest'));
      await until(() => !button('Flatten & compress')?.hasAttribute('disabled'), 'preview ready');
      await click(button('Flatten & compress'));
      await until(() => text().includes('Drawing page 1 of 3'), 'drawing started');
      await click(button('Cancel'));
      await until(() => $('[role=progressbar]') === null, 'progress bar gone');
      expect(seen?.aborted).toBe(true);
      expect(notify.info).toHaveBeenCalledWith('Canceled', 'Nothing was saved.');
      expect(notify.error).not.toHaveBeenCalled();
      expect(text()).not.toContain('% smaller');
    });

    it('rasterizing a small file gives a bigger one: nothing is offered', async () => {
      await mount((await import('./PdfCompressTool')).default);
      await pick({ name: 'tiny.pdf', bytes: await makePdf(1) });
      await until(() => text().includes('1 page'), 'file loaded');
      await click(button('Smallest'));
      await until(() => !button('Flatten & compress')?.hasAttribute('disabled'), 'preview ready');
      await click(button('Flatten & compress'));
      await until(() => text().includes('didn’t make the file smaller'), 'result');
      expect(button(/Download compressed/)).toBeUndefined();
    });
  });

  describe('Watermark PDF', () => {
    it('previews the stamp, validates the text, and stamps the file', async () => {
      await mount((await import('./PdfWatermarkTool')).default);
      await pick({ name: 'memo.pdf', bytes: await makePdf(3) });
      await until(() => text().includes('1 / 3'), 'file loaded');
      await until(() => $('svg text') !== null, 'live preview');
      expect($('svg text')?.textContent).toBe('CONFIDENTIAL');
      expect($('svg text')?.getAttribute('fill')).toBe('#6b7280');
      expect($('svg text')?.getAttribute('fill-opacity')).toBe('0.25');
      expect($('svg text')?.getAttribute('transform')).toMatch(/^rotate\(-45 /);

      await typeInto($<HTMLInputElement>('input[aria-label="Watermark text"]'), 'Привет');
      expect(text()).toContain('can’t draw “П”');
      expect($('svg text')).toBeNull();
      expect(button(/Download watermarked/)?.hasAttribute('disabled')).toBe(true);

      await typeInto($<HTMLInputElement>('input[aria-label="Watermark text"]'), 'DRAFT');
      await click(button('Tiled'));
      await until(() => host.querySelectorAll('svg text').length > 3, 'tiled preview');
      await click(button(/Download watermarked/));
      await until(() => downloads.length === 1, 'stamped');
      expect(downloads[0]?.name).toBe('memo-watermarked.pdf');
      expect((await PDFDocument.load(new Uint8Array(await only(downloads[0], 'a download').blob.arrayBuffer()))).getPageCount()).toBe(3);
    });

    it('only some pages: validates the range and says when the previewed page is not included', async () => {
      await mount((await import('./PdfWatermarkTool')).default);
      await pick({ name: 'memo.pdf', bytes: await makePdf(6) });
      await until(() => $('svg text') !== null, 'live preview');
      await click(host.querySelector('#wm-some'));
      await typeInto($<HTMLInputElement>('input[aria-label="Pages to watermark"]'), '9');
      expect(text()).toContain('Page 9 doesn’t exist');
      expect(button(/Download watermarked/)?.hasAttribute('disabled')).toBe(true);
      await typeInto($<HTMLInputElement>('input[aria-label="Pages to watermark"]'), '3-4');
      expect(text()).toContain('2 pages will be stamped.');
      expect(text()).toContain('Page 1 isn’t in your page range');
      expect($('svg text')).toBeNull();
      await click(button(/Download watermarked/));
      await until(() => downloads.length === 1, 'stamped');
    });
  });
});
