import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, IconButton, Input, Segmented, Slider, Switch } from '@/components/ui';
import { pagesInRanges, parseRanges, RANGE_EXAMPLE } from '@/features/tools/lib/pdf/ranges';
import type { WatermarkOptions, WatermarkPosition } from '@/features/tools/lib/pdf/types';
import { CAP_HEIGHT, cleanText, type FontMetrics, layoutStamps, MAX_TEXT_LENGTH, textWidth, unsupportedChars } from '@/features/tools/lib/pdf/watermarkLayout';
import { FileDrop, Problems } from '@/features/tools/pdf/FileDrop';
import { baseName, type LoadedPdf, pdfBlob, readPdfs } from '@/features/tools/pdf/files';
import { JobProgress } from '@/features/tools/pdf/JobProgress';
import { PagePreview } from '@/features/tools/pdf/PagePreview';
import { pdfRunner } from '@/features/tools/pdf/pdfRunner';
import { pageSize } from '@/features/tools/pdf/render';
import { useDocs } from '@/features/tools/pdf/useDocs';
import { usePdfJob } from '@/features/tools/pdf/usePdfJob';
import { Field } from '@/features/tools/ui';
import { cn } from '@/lib/cn';
import { downloadBlob } from '@/lib/download';
import { pluralize } from '@/lib/format';
import { notify } from '@/lib/toast';

const POSITIONS: ReadonlyArray<{ value: WatermarkPosition; label: string }> = [
  { value: 'top-left', label: 'Top left' },
  { value: 'top', label: 'Top' },
  { value: 'top-right', label: 'Top right' },
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'bottom-right', label: 'Bottom right' },
];

const SWATCHES = [
  { value: '#111111', label: 'Black' },
  { value: '#6b7280', label: 'Grey' },
  { value: '#dc2626', label: 'Red' },
  { value: '#2563eb', label: 'Blue' },
] as const;

export default function PdfWatermarkTool() {
  const [file, setFile] = useState<LoadedPdf | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [text, setText] = useState('CONFIDENTIAL');
  const [size, setSize] = useState(64);
  const [bold, setBold] = useState(true);
  const [color, setColor] = useState<string>('#6b7280');
  const [opacity, setOpacity] = useState(25);
  const [rotation, setRotation] = useState(45);
  const [layout, setLayout] = useState<'single' | 'tiled'>('single');
  const [position, setPosition] = useState<WatermarkPosition>('center');
  const [onlySome, setOnlySome] = useState(false);
  const [rangeText, setRangeText] = useState('');
  const [metrics, setMetrics] = useState<FontMetrics | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const job = usePdfJob();
  const doc = useDocs(file ? [file] : []).get(file?.id ?? '');

  // Per-character widths of the PDF fonts, measured once in the worker, so the preview can lay text out exactly as the PDF will.
  useEffect(() => {
    let cancelled = false;
    pdfRunner
      .run({ op: 'fontMetrics' })
      .then((out) => !cancelled && setMetrics(out.info as FontMetrics))
      .catch(() => !cancelled && notify.error('Couldn’t start the watermark tool', 'Reload the page and try again.'));
    return () => {
      cancelled = true;
    };
  }, []);

  // The page as the viewer sees it, in PDF points (what the layout works in).
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    pageSize(doc, page)
      .then((s) => !cancelled && setDims(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc, page]);

  const load = async (picked: File[]) => {
    const { ok, problems: p } = await readPdfs(picked.slice(0, 1));
    setProblems(p);
    if (!ok[0]) return;
    setFile(ok[0]);
    setPage(0);
    setDims(null);
    setRangeText('');
  };

  const widths = metrics ? (bold ? metrics.bold : metrics.regular) : null;
  const clean = cleanText(text);
  const missing = widths ? unsupportedChars(clean, widths) : [];
  const textError = !clean
    ? 'Type the text for the watermark.'
    : missing.length > 0
      ? `PDF’s built-in fonts can’t draw ${missing.map((c) => `“${c}”`).join(' ')}. Use letters, numbers and common punctuation.`
      : null;

  const parsed = onlySome && file ? parseRanges(rangeText, file.pages) : null;
  const pages = parsed?.ok ? pagesInRanges(parsed.ranges) : null;
  const rangeError = parsed && !parsed.ok && rangeText.trim() !== '' ? parsed.error : null;
  const ready = Boolean(metrics) && !textError && (!onlySome || Boolean(parsed?.ok));

  const stamps = useMemo(
    () => (widths && dims && !textError ? layoutStamps(dims, textWidth(clean, size, widths), size * CAP_HEIGHT, { rotation, layout, position }) : []),
    [widths, dims, textError, clean, size, rotation, layout, position],
  );
  const pageIncluded = !pages || pages.includes(page);

  const download = () => {
    if (!file || !ready) return Promise.resolve();
    const options: WatermarkOptions = { text: clean, size, bold, color, opacity: opacity / 100, rotation, layout, position, pages };
    return job.run(async (api) => {
      const { files: out } = await api.run({ op: 'watermark', bytes: file.bytes, options });
      const result = out[0];
      if (!result) throw new Error('Nothing was produced.');
      downloadBlob(`${baseName(file.name)}-watermarked.pdf`, pdfBlob(result));
      notify.success('Watermarked PDF saved', pluralize(pages?.length ?? file.pages, 'page'));
    }, 'Couldn’t add the watermark');
  };

  return (
    <div className="space-y-4">
      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          multiple={false}
          onFiles={load}
          title="Drop a PDF here, or click to choose"
          hint="Stamp text across the pages · stays on your device"
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
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
                {dims && pageIncluded && (
                  <svg viewBox={`0 0 ${dims.width} ${dims.height}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
                    {stamps.map((s) => (
                      <text
                        key={`${s.x.toFixed(2)}:${s.y.toFixed(2)}`}
                        x={s.x}
                        y={dims.height - s.y}
                        transform={`rotate(${-s.angle} ${s.x} ${dims.height - s.y})`}
                        fontSize={size}
                        fontWeight={bold ? 700 : 400}
                        fontFamily="Helvetica, Arial, 'Liberation Sans', sans-serif"
                        fill={color}
                        fillOpacity={opacity / 100}
                      >
                        {clean}
                      </text>
                    ))}
                  </svg>
                )}
              </PagePreview>
            )}
            {!pageIncluded && <p className="text-center text-xs text-muted-foreground">Page {page + 1} isn’t in your page range, so it won’t be stamped.</p>}
          </div>

          <div className="space-y-4">
            <Field label="Watermark text" hint={`${clean.length}/${MAX_TEXT_LENGTH}`}>
              <Input
                value={text}
                maxLength={MAX_TEXT_LENGTH}
                onChange={(e) => setText(e.target.value)}
                aria-label="Watermark text"
                aria-invalid={Boolean(textError)}
                aria-describedby="wm-text-help"
                autoComplete="off"
              />
              <p id="wm-text-help" aria-live="polite" className={cn('min-h-4 text-xs', textError ? 'text-destructive-text' : 'text-subtle-foreground')}>
                {textError ?? (metrics ? ' ' : 'Loading fonts…')}
              </p>
            </Field>

            <div className="flex items-center justify-between gap-3 rounded-lg border p-2.5">
              <label htmlFor="wm-bold" className="text-[13px]">
                Bold
              </label>
              <Switch id="wm-bold" checked={bold} onCheckedChange={setBold} aria-label="Bold" />
            </div>

            <Field label="Size" hint={`${size} pt`}>
              <Slider aria-label="Font size" min={12} max={200} step={2} value={size} onValueChange={setSize} />
            </Field>

            <Field label="Colour">
              <div className="flex items-center gap-2">
                {SWATCHES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    aria-label={s.label}
                    aria-pressed={color === s.value}
                    onClick={() => setColor(s.value)}
                    className={cn(
                      'size-7 rounded-full border-2 outline-offset-2 transition-transform active:scale-90',
                      color === s.value ? 'border-brand' : 'border-transparent ring-1 ring-border',
                    )}
                    style={{ background: s.value }}
                  />
                ))}
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  aria-label="Custom colour"
                  className="ml-1 h-7 w-10 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
                />
              </div>
            </Field>

            <Field label="Opacity" hint={`${opacity}%`}>
              <Slider aria-label="Opacity" min={5} max={100} step={5} value={opacity} onValueChange={setOpacity} />
            </Field>

            <Field label="Rotation" hint={`${rotation}°`}>
              <Slider aria-label="Rotation" min={-90} max={90} step={5} value={rotation} onValueChange={setRotation} />
            </Field>

            <Field label="Layout">
              <Segmented<'single' | 'tiled'>
                aria-label="Layout"
                fullWidth
                value={layout}
                onValueChange={setLayout}
                options={[
                  { value: 'single', label: 'One' },
                  { value: 'tiled', label: 'Tiled' },
                ]}
              />
            </Field>

            {layout === 'single' && (
              <Field label="Position">
                {/* biome-ignore lint/a11y/useSemanticElements: a 3×3 grid of toggle buttons; a <fieldset> would add a border and legend we don't want */}
                <div role="group" aria-label="Position" className="grid w-32 grid-cols-3 gap-1">
                  {POSITIONS.map((p) => {
                    const active = position === p.value;
                    return (
                      <button
                        key={p.value}
                        type="button"
                        aria-label={p.label}
                        aria-pressed={active}
                        onClick={() => setPosition(p.value)}
                        className={cn(
                          'grid aspect-square place-items-center rounded-md border outline-offset-2 transition-colors',
                          active ? 'border-brand bg-brand-soft' : 'hover:bg-accent',
                        )}
                      >
                        <span className={cn('size-2 rounded-full', active ? 'bg-brand' : 'bg-muted-foreground/40')} />
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}

            <div className="space-y-2 rounded-lg border p-2.5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="wm-some" className="text-[13px]">
                  Only some pages
                </label>
                <Switch id="wm-some" checked={onlySome} onCheckedChange={setOnlySome} aria-label="Only some pages" />
              </div>
              {onlySome && (
                <>
                  <Input
                    value={rangeText}
                    onChange={(e) => setRangeText(e.target.value)}
                    placeholder={RANGE_EXAMPLE}
                    aria-label="Pages to watermark"
                    aria-invalid={Boolean(rangeError)}
                    aria-describedby="wm-range-help"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <p id="wm-range-help" aria-live="polite" className={cn('text-xs', rangeError ? 'text-destructive-text' : 'text-subtle-foreground')}>
                    {rangeError ?? (pages ? `${pluralize(pages.length, 'page')} will be stamped.` : `Pages like ${RANGE_EXAMPLE}`)}
                  </p>
                </>
              )}
            </div>

            {job.busy ? (
              <JobProgress stacked progress={job.progress} onCancel={job.cancel} />
            ) : (
              <Button variant="primary" className="w-full" disabled={!ready} onClick={() => void download()}>
                <Download /> Download watermarked PDF
              </Button>
            )}
            <Button
              variant="ghost"
              className="w-full"
              disabled={job.busy}
              onClick={() => {
                setFile(null);
                setDims(null);
              }}
            >
              Choose another file
            </Button>
            <p className="text-xs leading-relaxed text-subtle-foreground">
              The text is added on top of each page; the original file isn’t modified. It uses a standard PDF font, so letters outside the Latin alphabet aren’t
              supported.
            </p>
          </div>
        </div>
      )}
      <Problems items={problems} />
    </div>
  );
}
