import { useEffect, useRef, useState } from 'react';
import { closePdf, openPdf, type PdfDoc } from '@/features/tools/pdf/render';

/** pdf.js documents for a set of loaded files (opened once, released when a file is removed or the tool closes). */
export function useDocs(files: ReadonlyArray<{ id: string; bytes: Uint8Array }>): Map<string, PdfDoc> {
  const cache = useRef(new Map<string, PdfDoc>());
  const [, bump] = useState(0);

  useEffect(() => {
    const live = new Set(files.map((f) => f.id));
    let cancelled = false;
    for (const [id, doc] of cache.current) {
      if (!live.has(id)) {
        void closePdf(doc);
        cache.current.delete(id);
      }
    }
    for (const f of files) {
      if (cache.current.has(f.id)) continue;
      void openPdf(f.bytes)
        .then((doc) => {
          if (cancelled || !files.some((x) => x.id === f.id)) return void closePdf(doc);
          cache.current.set(f.id, doc);
          bump((n) => n + 1);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [files]);

  useEffect(
    () => () => {
      for (const doc of cache.current.values()) void closePdf(doc);
      cache.current.clear();
    },
    [],
  );

  return cache.current;
}
