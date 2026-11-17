import { Download, FileArchive } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button, IconButton, Input, Segmented } from '@/components/ui';
import { describeRange, outputNames, type PageRange, pageCountOf, planSplit, RANGE_EXAMPLE, type SplitMode, summarize } from '@/features/tools/lib/pdf/ranges';
import { zipBlob } from '@/features/tools/lib/pdf/zip';
import { FileDrop, Problems } from '@/features/tools/pdf/FileDrop';
import { baseName, type LoadedPdf, pdfBlob, readPdfs } from '@/features/tools/pdf/files';
import { JobProgress } from '@/features/tools/pdf/JobProgress';
import { PageThumb } from '@/features/tools/pdf/PageThumb';
import { useDocs } from '@/features/tools/pdf/useDocs';
import { usePdfJob } from '@/features/tools/pdf/usePdfJob';
import { Field } from '@/features/tools/ui';
import { cn } from '@/lib/cn';
import { downloadBlob } from '@/lib/download';
import { formatBytes, pluralize } from '@/lib/format';
import { notify } from '@/lib/toast';

type Part = { name: string; bytes: Uint8Array; range: PageRange };
type Done = { key: string; parts: Part[] };

const MODES = [
  { value: 'ranges', label: 'Ranges' },
  { value: 'every', label: 'Every N pages' },
  { value: 'each', label: 'Each page' },
] as const satisfies ReadonlyArray<{ value: SplitMode; label: string }>;

/** One line under the inputs: what the current settings will produce. */
function describePlan(mode: SplitMode, s: ReturnType<typeof summarize>, total: number): string {
  const files = pluralize(s.files, 'file');
  if (mode !== 'ranges') return `${files} · ${pluralize(total, 'page')} in all`;
  const used = `${s.pagesUsed} of ${pluralize(total, 'page')} used${s.unused > 0 ? `, ${s.unused} left out` : ''}`;
  return [files, used, ...(s.pagesOut > s.pagesUsed ? ['some pages appear in more than one file'] : [])].join(' · ');
}

export default function PdfSplitTool() {
  const [file, setFile] = useState<LoadedPdf | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [mode, setMode] = useState<SplitMode>('ranges');
  const [ranges, setRanges] = useState('');
  const [every, setEvery] = useState('2');
  const [done, setDone] = useState<Done | null>(null);
  const job = usePdfJob();
  const doc = useDocs(file ? [file] : []).get(file?.id ?? '');

  const load = async (picked: File[]) => {
    const { ok, problems: p } = await readPdfs(picked.slice(0, 1));
    setProblems(p);
    if (!ok[0]) return;
    setFile(ok[0]);
    setDone(null);
    setRanges('');
  };

  const total = file?.pages ?? 0;
  const plan = useMemo(() => planSplit(mode, total, { ranges, every: every.trim() === '' ? Number.NaN : Number(every) }), [mode, total, ranges, every]);
  const names = useMemo(() => (file && plan.ok ? outputNames(baseName(file.name), plan.groups, total) : []), [file, plan, total]);
  // Results belong to the plan that made them: change the ranges and the old list is hidden rather than left to mislead.
  const key = plan.ok ? JSON.stringify(plan.groups) : '';
  const parts = done && done.key === key ? done.parts : null;
  const summary = plan.ok ? summarize(plan.groups, total) : null;
  const untouched = mode === 'ranges' && ranges.trim() === ''; // nothing typed yet: a hint, not an error

  const split = () => {
    if (!file || !plan.ok) return Promise.resolve();
    const groups = plan.groups;
    return job.run(async (api) => {
      const { files: out } = await api.run({ op: 'split', bytes: file.bytes, ranges: groups });
      if (out.length !== groups.length) throw new Error('Some files were not produced.');
      setDone({ key, parts: out.map((bytes, i) => ({ name: names[i] ?? `part-${i + 1}.pdf`, bytes, range: groups[i] as PageRange })) });
      notify.success('Split done', `${pluralize(out.length, 'file')} · ${formatBytes(out.reduce((n, b) => n + b.length, 0))}`);
    }, 'Couldn’t split');
  };

  const downloadAll = () => {
    if (!file || !parts) return;
    try {
      downloadBlob(`${baseName(file.name)}-split.zip`, zipBlob(parts.map((p) => ({ name: p.name, data: p.bytes }))));
    } catch (err) {
      notify.error('Couldn’t make the ZIP', err instanceof Error ? err.message : 'Download the files one at a time instead.');
    }
  };

  const feedbackId = 'split-feedback';

  return (
    <div className="space-y-4">
      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          multiple={false}
          onFiles={load}
          title="Drop a PDF here, or click to choose"
          hint="Cut it into several PDFs by page range · stays on your device"
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
                setDone(null);
              }}
            >
              Choose another
            </Button>
          </div>

          <div className="space-y-4 rounded-lg border bg-card p-3">
            <Segmented<SplitMode>
              aria-label="How to split"
              size="sm"
              fullWidth
              value={mode}
              onValueChange={(m) => {
                if (!job.busy) setMode(m);
              }}
              options={MODES}
            />

            {mode === 'ranges' && (
              <Field label="Pages for each file" hint={`like ${RANGE_EXAMPLE}`}>
                <Input
                  value={ranges}
                  onChange={(e) => setRanges(e.target.value)}
                  placeholder={RANGE_EXAMPLE}
                  inputMode="text"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Page ranges"
                  aria-invalid={!plan.ok && !untouched}
                  aria-describedby={feedbackId}
                  disabled={job.busy}
                />
              </Field>
            )}
            {mode === 'every' && (
              <Field label="Pages per file">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={Math.max(1, total - 1)}
                  step={1}
                  value={every}
                  onChange={(e) => setEvery(e.target.value)}
                  aria-label="Pages per file"
                  aria-invalid={!plan.ok}
                  aria-describedby={feedbackId}
                  className="w-32"
                  disabled={job.busy}
                />
              </Field>
            )}

            <p id={feedbackId} aria-live="polite" className={cn('text-[13px]', plan.ok || untouched ? 'text-muted-foreground' : 'text-destructive-text')}>
              {plan.ok && summary
                ? describePlan(mode, summary, total)
                : untouched
                  ? `This PDF has ${pluralize(total, 'page')}. Each comma-separated item becomes its own file: “1-3” is pages 1 to 3, “8-” is page 8 to the end.`
                  : !plan.ok && plan.error}
            </p>

            {plan.ok && !parts && (
              <ol aria-label="Files that will be made" className="max-h-56 divide-y overflow-y-auto rounded-md border text-[13px]">
                {plan.groups.map((g, i) => (
                  <li key={names[i] ?? i} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                    <span className="min-w-0 truncate" title={names[i]}>
                      {names[i]}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {describeRange(g)}
                      {g.from !== g.to && ` · ${pageCountOf(g)}`}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="primary" disabled={!plan.ok || job.busy} onClick={() => void split()}>
                <Download /> {plan.ok ? `Split into ${pluralize(plan.groups.length, 'file')}` : 'Split'}
              </Button>
            </div>
            {job.busy && <JobProgress progress={job.progress} onCancel={job.cancel} />}
          </div>

          {parts && (
            <section aria-label="Split results" className="space-y-2 rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p role="status" className="text-sm font-medium">
                  {pluralize(parts.length, 'file')} ready · {formatBytes(parts.reduce((n, p) => n + p.bytes.length, 0))}
                </p>
                <Button variant="primary" onClick={downloadAll}>
                  <FileArchive /> Download all (.zip)
                </Button>
              </div>
              <ul className="max-h-72 divide-y overflow-y-auto rounded-md border text-[13px]">
                {parts.map((p) => (
                  <li key={p.name} className="flex items-center gap-2 py-1 pl-3 pr-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" title={p.name}>
                        {p.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {describeRange(p.range)} · {formatBytes(p.bytes.length)}
                      </span>
                    </span>
                    <IconButton label={`Download ${p.name}`} size="icon-sm" onClick={() => downloadBlob(p.name, pdfBlob(p.bytes))}>
                      <Download />
                    </IconButton>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-subtle-foreground">The ZIP just bundles the files (they’re already compressed). Nothing was uploaded.</p>
            </section>
          )}
        </>
      )}
      <Problems items={problems} />
    </div>
  );
}
