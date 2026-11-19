import { Download, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Button, Segmented, Select, Slider } from '@/components/ui';
import { inBand } from '@/features/tools/lib/pdf/job';
import { type CompressLevel, DPI_CHOICES, isSmaller, percentSaved, RASTER_PRESETS } from '@/features/tools/lib/pdf/rasterPlan';
import type { RasterPage } from '@/features/tools/lib/pdf/types';
import { FileDrop, Problems } from '@/features/tools/pdf/FileDrop';
import { baseName, type LoadedPdf, pdfBlob, readPdfs } from '@/features/tools/pdf/files';
import { JobProgress } from '@/features/tools/pdf/JobProgress';
import { PageThumb } from '@/features/tools/pdf/PageThumb';
import { rasterizePage } from '@/features/tools/pdf/render';
import { useDocs } from '@/features/tools/pdf/useDocs';
import { usePdfJob } from '@/features/tools/pdf/usePdfJob';
import { Field } from '@/features/tools/ui';
import { downloadBlob } from '@/lib/download';
import { formatBytes, pluralize } from '@/lib/format';

const LEVELS = [
  { value: 'lossless', label: 'Lossless' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'small', label: 'Smallest' },
] as const satisfies ReadonlyArray<{ value: CompressLevel; label: string }>;

const DPI_LABEL: Record<(typeof DPI_CHOICES)[number], string> = {
  72: '72 dpi · screen, smallest',
  96: '96 dpi · screen',
  110: '110 dpi · balanced',
  150: '150 dpi · good print',
  200: '200 dpi · sharp print',
};

/** `bytes` is kept only when the result is smaller than the original — a bigger one is never offered, so it isn't held either. */
type Result = { key: string; level: CompressLevel; before: number; after: number; bytes: Uint8Array | null };

export default function PdfCompressTool() {
  const [file, setFile] = useState<LoadedPdf | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [level, setLevel] = useState<CompressLevel>('lossless');
  const [dpi, setDpi] = useState<number>(RASTER_PRESETS.balanced.dpi);
  const [quality, setQuality] = useState(Math.round(RASTER_PRESETS.balanced.quality * 100));
  const [result, setResult] = useState<Result | null>(null);
  const job = usePdfJob();
  const doc = useDocs(file ? [file] : []).get(file?.id ?? '');

  const load = async (picked: File[]) => {
    const { ok, problems: p } = await readPdfs(picked.slice(0, 1));
    setProblems(p);
    if (!ok[0]) return;
    setFile(ok[0]);
    setResult(null);
  };

  const raster = level !== 'lossless';
  const key = raster ? `${level}|${dpi}|${quality}` : level;
  const shown = result && result.key === key ? result : null; // a result belongs to the settings that made it

  const choose = (next: CompressLevel) => {
    setLevel(next);
    if (next !== 'lossless') {
      setDpi(RASTER_PRESETS[next].dpi);
      setQuality(Math.round(RASTER_PRESETS[next].quality * 100));
    }
  };

  const compress = () => {
    if (!file) return Promise.resolve();
    const settings = { dpi, quality: quality / 100 };
    return job.run(async (api) => {
      const before = file.bytes.length;
      let bytes: Uint8Array | undefined;
      if (!raster) {
        bytes = (await api.run({ op: 'optimize', bytes: file.bytes })).files[0];
      } else {
        if (!doc) throw new Error('The page previews are still loading. Try again in a moment.');
        // Drawing needs a canvas, so it happens here (one page at a time); the PDF is rebuilt in the worker.
        const pages: RasterPage[] = [];
        for (let i = 0; i < file.pages; i++) {
          api.step(inBand({ done: i, total: file.pages, label: `Drawing page ${i + 1} of ${file.pages}` }, 0, 0.8));
          pages.push(await rasterizePage(doc, i, settings, api.signal));
        }
        bytes = (await api.run({ op: 'rebuild', pages }, [0.8, 1])).files[0];
      }
      if (!bytes) throw new Error('Nothing was produced.');
      setResult({ key, level, before, after: bytes.length, bytes: isSmaller(before, bytes.length) ? bytes : null });
    }, 'Couldn’t compress');
  };

  const smaller = shown?.bytes ?? null;
  const saved = shown ? percentSaved(shown.before, shown.after) : 0;

  return (
    <div className="space-y-4">
      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          multiple={false}
          onFiles={load}
          title="Drop a PDF here, or click to choose"
          hint="Make it smaller to email or upload · stays on your device"
        />
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-lg border bg-card p-2 pr-2.5">
            <span className="grid h-14 w-11 shrink-0 place-items-center overflow-hidden rounded-sm">
              {doc ? <PageThumb doc={doc} index={0} width={44} /> : <span className="size-full bg-muted" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium" title={file.name}>
                {file.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {pluralize(file.pages, 'page')} · {formatBytes(file.bytes.length)}
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={job.busy}
              onClick={() => {
                setFile(null);
                setResult(null);
              }}
            >
              Choose another
            </Button>
          </div>

          <div className="space-y-4 rounded-lg border bg-card p-3">
            <Segmented<CompressLevel>
              aria-label="Compression level"
              fullWidth
              value={level}
              onValueChange={(l) => {
                if (!job.busy) choose(l);
              }}
              options={LEVELS}
            />

            {!raster ? (
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                <strong className="font-medium text-foreground">Keeps everything</strong> — text stays selectable, links, forms and bookmarks keep working. Only
                wasted data is removed (unused objects, uncompressed streams). Savings are often modest and depend on how the file was made; a PDF that is
                mostly photos or scans won’t shrink much.
              </p>
            ) : (
              <>
                <div role="note" className="flex gap-2.5 rounded-md bg-warning-soft px-3 py-2 text-[13px] leading-relaxed text-warning-text">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <p>
                    <strong className="font-medium">This flattens the PDF.</strong> Every page is redrawn as a picture, so text can no longer be selected,
                    searched or copied, and links and form fields stop working. Best for scans and slides you only need to view or print.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Resolution">
                    <Select
                      aria-label="Resolution"
                      value={String(dpi)}
                      onValueChange={(v) => setDpi(Number(v))}
                      options={DPI_CHOICES.map((d) => ({ value: String(d), label: DPI_LABEL[d] }))}
                    />
                  </Field>
                  <Field label="Picture quality" hint={`${quality}%`}>
                    <Slider aria-label="Picture quality" min={30} max={95} step={5} value={quality} onValueChange={setQuality} />
                  </Field>
                </div>
              </>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="primary" disabled={job.busy || (raster && !doc)} onClick={() => void compress()}>
                {raster ? 'Flatten & compress' : 'Clean up & compress'}
              </Button>
            </div>
            {job.busy && <JobProgress progress={job.progress} onCancel={job.cancel} />}
          </div>

          {shown && (
            <section aria-label="Compression result" className="space-y-3 rounded-lg border bg-card p-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Before</p>
                  <p className="tabular text-base font-semibold">{formatBytes(shown.before)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">After</p>
                  <p className="tabular text-base font-semibold">{formatBytes(shown.after)}</p>
                </div>
              </div>
              {smaller ? (
                <>
                  <div role="img" aria-label={`${saved}% smaller`} className="relative h-2 overflow-hidden rounded-full bg-muted" title={`${saved}% smaller`}>
                    <span className="block h-full rounded-full bg-success" style={{ width: `${Math.max(2, 100 - saved)}%` }} />
                  </div>
                  <p role="status" className="text-sm">
                    <strong className="font-semibold text-success-text">{saved}% smaller</strong>
                    <span className="text-muted-foreground"> — saved {formatBytes(shown.before - shown.after)}.</span>
                    {shown.level !== 'lossless' && <span className="text-muted-foreground"> Text in this version can’t be selected.</span>}
                  </p>
                  <Button variant="primary" onClick={() => downloadBlob(`${baseName(file.name)}-compressed.pdf`, pdfBlob(smaller))}>
                    <Download /> Download compressed PDF
                  </Button>
                </>
              ) : (
                <p role="status" className="rounded-md bg-muted/60 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground">
                  {shown.level === 'lossless'
                    ? 'This file is already as small as a lossless clean-up can make it, so there’s nothing worth downloading. Balanced or Smallest can go further (they flatten the text).'
                    : 'This setting didn’t make the file smaller — its pages are already well compressed. Nothing was kept; try Smallest, or lower the resolution or quality.'}
                </p>
              )}
            </section>
          )}
        </>
      )}
      <Problems items={problems} />
    </div>
  );
}
