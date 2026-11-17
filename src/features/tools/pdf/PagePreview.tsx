import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type PdfDoc, pageSize, renderPage } from '@/features/tools/pdf/render';
import { cn } from '@/lib/cn';

/**
 * A large, sharp preview of one page. `children` are laid over it in a box that is exactly the page's size, so
 * anything positioned in percentages lines up with the page (crop frames, signatures…).
 * `onRatio` reports height/width of the page as displayed.
 */
export function PagePreview({
  doc,
  index,
  maxWidth = 620,
  onRatio,
  children,
  className,
}: {
  doc: PdfDoc;
  index: number;
  maxWidth?: number;
  onRatio?: (ratio: number) => void;
  children?: ReactNode;
  className?: string;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState(1.41);
  const [failed, setFailed] = useState(false);
  const report = useRef(onRatio);
  report.current = onRatio;

  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, Math.min(maxWidth, Math.floor(el.clientWidth))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    pageSize(doc, index)
      .then((s) => {
        if (cancelled) return;
        setRatio(s.height / s.width);
        report.current?.(s.height / s.width);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [doc, index]);

  useEffect(() => {
    if (!width || !canvas.current) return;
    let cancelled = false;
    const ac = new AbortController();
    renderPage(doc, index, canvas.current, width, ac.signal).catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [doc, index, width]);

  return (
    <div ref={outer} className={cn('flex w-full justify-center', className)}>
      <div
        className="relative select-none overflow-hidden rounded-md border bg-white shadow-sm"
        style={{ width: width || '100%', height: width ? width * ratio : undefined, aspectRatio: width ? undefined : `1 / ${ratio}` }}
      >
        {failed ? (
          <span className="absolute inset-0 grid place-items-center text-sm text-neutral-500">Can’t preview this page</span>
        ) : (
          <canvas ref={canvas} role="img" aria-label={`Page ${index + 1}`} className="absolute inset-0 size-full bg-white" />
        )}
        <div className="absolute inset-0">{children}</div>
      </div>
    </div>
  );
}
