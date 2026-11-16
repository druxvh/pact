import { ArrowDown, ArrowUp, Download, FilePlus2, GripVertical, X } from 'lucide-react';
import { useState } from 'react';
import { Button, IconButton } from '@/components/ui';
import { mergePdfs } from '@/features/tools/lib/pdf/ops';
import { FileDrop, Problems } from '@/features/tools/pdf/FileDrop';
import { baseName, type LoadedPdf, pdfBlob, readPdfs } from '@/features/tools/pdf/files';
import { moveItem } from '@/features/tools/pdf/order';
import { PageThumb } from '@/features/tools/pdf/PageThumb';
import { useDocs } from '@/features/tools/pdf/useDocs';
import { cn } from '@/lib/cn';
import { downloadBlob } from '@/lib/download';
import { formatBytes, pluralize } from '@/lib/format';
import { notify } from '@/lib/toast';

export default function PdfMergeTool() {
  const [files, setFiles] = useState<LoadedPdf[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const docs = useDocs(files);

  const add = async (picked: File[]) => {
    const { ok, problems: p } = await readPdfs(picked);
    setProblems(p);
    if (ok.length) setFiles((cur) => [...cur, ...ok]);
  };

  const totalPages = files.reduce((n, f) => n + f.pages, 0);

  const merge = async () => {
    setBusy(true);
    try {
      const out = await mergePdfs(files.map((f) => f.bytes));
      downloadBlob(`${files.length === 2 ? `${baseName(files[0]?.name ?? 'merged')}+${baseName(files[1]?.name ?? '')}` : 'merged'}.pdf`, pdfBlob(out));
      notify.success('Merged', `${pluralize(totalPages, 'page')} · ${formatBytes(out.length)}`);
    } catch (err) {
      notify.error('Couldn’t merge', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <FileDrop
        accept="application/pdf,.pdf"
        onFiles={(f) => void add(f)}
        title={files.length ? 'Add more PDFs' : 'Drop PDFs here, or click to choose'}
        hint="Merge in the order you arrange them · stays on your device"
        compact={files.length > 0}
      />
      <Problems items={problems} />

      {files.length > 0 && (
        <>
          <ol className="space-y-2" aria-label="Files to merge, in order">
            {files.map((f, i) => {
              const doc = docs.get(f.id);
              return (
                <li
                  key={f.id}
                  draggable
                  onDragStart={() => setDragFrom(i)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(i);
                  }}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  onDrop={() => {
                    if (dragFrom !== null) setFiles((cur) => moveItem(cur, dragFrom, i));
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border bg-card p-2 pr-2.5 transition-colors',
                    dragOver === i && dragFrom !== i && 'border-brand bg-brand-soft',
                    dragFrom === i && 'opacity-50',
                  )}
                >
                  <GripVertical className="size-4 shrink-0 cursor-grab text-subtle-foreground" aria-hidden="true" />
                  <span className="grid h-14 w-11 shrink-0 place-items-center overflow-hidden rounded-sm">
                    {doc ? <PageThumb doc={doc} index={0} width={44} /> : <span className="size-full bg-muted" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{f.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {pluralize(f.pages, 'page')} · {formatBytes(f.bytes.length)}
                    </span>
                  </span>
                  <span className="tabular w-6 text-center text-xs text-subtle-foreground">{i + 1}</span>
                  <IconButton label={`Move ${f.name} up`} size="icon-sm" disabled={i === 0} onClick={() => setFiles((c) => moveItem(c, i, i - 1))}>
                    <ArrowUp />
                  </IconButton>
                  <IconButton
                    label={`Move ${f.name} down`}
                    size="icon-sm"
                    disabled={i === files.length - 1}
                    onClick={() => setFiles((c) => moveItem(c, i, i + 1))}
                  >
                    <ArrowDown />
                  </IconButton>
                  <IconButton label={`Remove ${f.name}`} size="icon-sm" onClick={() => setFiles((c) => c.filter((x) => x.id !== f.id))}>
                    <X />
                  </IconButton>
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-muted-foreground">
              {pluralize(files.length, 'file')} · {pluralize(totalPages, 'page')} in total
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setFiles([])}>
                Clear
              </Button>
              <Button variant="primary" loading={busy} disabled={files.length < 2} onClick={() => void merge()}>
                {files.length < 2 ? (
                  <>
                    <FilePlus2 /> Add another PDF
                  </>
                ) : (
                  <>
                    <Download /> Merge &amp; download
                  </>
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
