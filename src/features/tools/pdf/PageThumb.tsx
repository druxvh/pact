import { useEffect, useRef, useState } from 'react';
import { type PdfDoc, pageSize, renderPage } from '@/features/tools/pdf/render';
import { cn } from '@/lib/cn';

/** One page, drawn only once it scrolls into view. `turn` rotates it visually (instant, no re-render). */
export function PageThumb({ doc, index, width = 140, turn = 0, className }: { doc: PdfDoc; index: number; width?: number; turn?: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState<number | null>(null); // height / width of the unrotated page
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => entry?.isIntersecting && setVisible(true), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    pageSize(doc, index)
      .then((s) => !cancelled && setRatio(s.height / s.width))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [doc, index]);

  useEffect(() => {
    if (!visible || !canvas.current) return;
    let cancelled = false;
    renderPage(doc, index, canvas.current, width * 2).catch(() => !cancelled && setFailed(true)); // 2× → stays sharp when rotated/scaled
    return () => {
      cancelled = true;
    };
  }, [visible, doc, index, width]);

  const turned = turn % 180 !== 0;
  const h = (ratio ?? 1.41) * width;
  const boxW = turned ? h : width;
  const boxH = turned ? width : h;

  return (
    <div ref={host} className={cn('relative shrink-0 overflow-hidden rounded-md border bg-white shadow-xs', className)} style={{ width: boxW, height: boxH }}>
      {failed ? (
        <span className="absolute inset-0 grid place-items-center text-[11px] text-neutral-500">Can’t preview</span>
      ) : (
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Page ${index + 1}`}
          className="absolute left-1/2 top-1/2 origin-center bg-white"
          style={{ width, height: h, transform: `translate(-50%, -50%) rotate(${turn}deg)` }}
        />
      )}
    </div>
  );
}
