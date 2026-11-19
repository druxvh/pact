import { ChevronLeft, ChevronRight, Download, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, IconButton, Input, Switch } from '@/components/ui';
import { type FRect, FULL_PAGE, isFullPage, marginsFromRect, rectFromMargins } from '@/features/tools/lib/pdf/geometry';
import { FileDrop, Problems } from '@/features/tools/pdf/FileDrop';
import { baseName, type LoadedPdf, pdfBlob, readPdfs } from '@/features/tools/pdf/files';
import { JobProgress } from '@/features/tools/pdf/JobProgress';
import { PagePreview } from '@/features/tools/pdf/PagePreview';
import { RectBox } from '@/features/tools/pdf/RectBox';
import { useDocs } from '@/features/tools/pdf/useDocs';
import { usePdfJob } from '@/features/tools/pdf/usePdfJob';
import { Field } from '@/features/tools/ui';
import { downloadBlob } from '@/lib/download';
import { notify } from '@/lib/toast';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** A percent field that lets you type freely (blank, "1", "12.") and only reports valid numbers; follows outside changes when not being edited. */
function PercentInput({ id, label, value, onValue }: { id: string; label: string; value: number; onValue: (pct: number) => void }) {
  const shown = String(Math.round(value * 10) / 10);
  const [text, setText] = useState<string | null>(null); // non-null while the field is being edited
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={0}
      max={90}
      step={1}
      id={id}
      aria-label={label}
      value={text ?? shown}
      onFocus={(e) => {
        setText(shown);
        e.currentTarget.select();
      }}
      onBlur={() => setText(null)}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number.parseFloat(e.target.value);
        if (Number.isFinite(n)) onValue(n);
      }}
    />
  );
}

export default function PdfCropTool() {
  const [file, setFile] = useState<LoadedPdf | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [crops, setCrops] = useState<FRect[]>([]);
  const [all, setAll] = useState(true);
  const job = usePdfJob();
  const doc = useDocs(file ? [file] : []).get(file?.id ?? '');

  const load = async (picked: File[]) => {
    const { ok, problems: p } = await readPdfs(picked.slice(0, 1));
    setProblems(p);
    const f = ok[0];
    if (!f) return;
    setFile(f);
    setPage(0);
    setCrops(Array.from({ length: f.pages }, () => FULL_PAGE));
  };

  const rect = crops[page] ?? FULL_PAGE;
  const setRect = (r: FRect) => setCrops((cur) => (all ? cur.map(() => r) : cur.map((c, i) => (i === page ? r : c))));
  // Turning "all pages" on makes every page share the current frame.
  useEffect(() => {
    if (all) setCrops((cur) => cur.map((c, i) => (cur[page] && i !== page ? cur[page] : c)));
  }, [all, page]);

  const margins = marginsFromRect(rect);
  const setMargin = (side: (typeof SIDES)[number], pct: number) => {
    const m = { ...marginsFromRect(rect), [side]: Math.min(0.9, Math.max(0, pct / 100)) };
    const r = rectFromMargins(m);
    if (r.width > 0.04 && r.height > 0.04) setRect(r);
  };

  const download = async () => {
    if (!file) return;
    const edits = crops.map((c) => (isFullPage(c) ? null : c));
    if (edits.every((c) => c === null)) {
      notify.info('Nothing to crop', 'Drag the frame (or set the margins) first.');
      return;
    }
    await job.run(async (api) => {
      const { files: out } = await api.run({ op: 'crop', bytes: file.bytes, crops: edits });
      const cropped = out[0];
      if (!cropped) throw new Error('Nothing was produced.');
      downloadBlob(`${baseName(file.name)}-cropped.pdf`, pdfBlob(cropped));
      notify.success('Cropped PDF saved');
    }, 'Couldn’t crop');
  };

  return (
    <div className="space-y-4">
      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          multiple={false}
          onFiles={load}
          title="Drop a PDF here, or click to choose"
          hint="Trim the margins off every page · stays on your device"
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium" title={file.name}>
                {file.name}
              </span>
              <span className="flex items-center gap-1">
                <IconButton label="Previous page" size="icon-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft />
                </IconButton>
                <span className="tabular w-20 text-center text-[13px] text-muted-foreground" role="status">
                  {page + 1} / {file.pages}
                </span>
                <IconButton label="Next page" size="icon-sm" disabled={page >= file.pages - 1} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight />
                </IconButton>
              </span>
            </div>
            {doc && (
              <PagePreview doc={doc} index={page}>
                <RectBox rect={rect} onChange={setRect} label={`Crop area, page ${page + 1}`} dimOutside />
              </PagePreview>
            )}
          </div>

          <div className="space-y-4">
            <Field label="Trim from each side" hint="%">
              <div className="grid grid-cols-2 gap-2">
                {SIDES.map((s) => (
                  <label key={s} htmlFor={`crop-${s}`} className="space-y-1 text-xs capitalize text-muted-foreground">
                    {s}
                    <PercentInput id={`crop-${s}`} label={`Trim ${s} (%)`} value={margins[s] * 100} onValue={(pct) => setMargin(s, pct)} />
                  </label>
                ))}
              </div>
            </Field>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-2.5">
              <label htmlFor="crop-all" className="text-[13px]">
                Same crop on every page
              </label>
              <Switch id="crop-all" checked={all} onCheckedChange={setAll} aria-label="Same crop on every page" />
            </div>
            <Button variant="outline" className="w-full" disabled={job.busy} onClick={() => setRect(FULL_PAGE)}>
              <RotateCcw /> Reset this page
            </Button>
            {job.busy ? (
              <JobProgress stacked progress={job.progress} onCancel={job.cancel} />
            ) : (
              <Button variant="primary" className="w-full" onClick={() => void download()}>
                <Download /> Download cropped PDF
              </Button>
            )}
            <Button
              variant="ghost"
              className="w-full"
              disabled={job.busy}
              onClick={() => {
                setFile(null);
                setCrops([]);
              }}
            >
              Choose another file
            </Button>
            <p className="text-xs leading-relaxed text-subtle-foreground">
              The crop hides the outside area (it changes the page size); the original file isn’t modified.
            </p>
          </div>
        </div>
      )}
      <Problems items={problems} />
    </div>
  );
}
