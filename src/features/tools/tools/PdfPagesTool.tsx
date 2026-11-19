import { CheckSquare, Download, FilePlus2, RotateCcw, RotateCw, Square, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, IconButton } from '@/components/ui';
import type { PageRef } from '@/features/tools/lib/pdf/types';
import { FileDrop, Problems } from '@/features/tools/pdf/FileDrop';
import { baseName, type LoadedPdf, nextId, pdfBlob, readPdfs } from '@/features/tools/pdf/files';
import { JobProgress } from '@/features/tools/pdf/JobProgress';
import { moveItem } from '@/features/tools/pdf/order';
import { PageThumb } from '@/features/tools/pdf/PageThumb';
import { useDocs } from '@/features/tools/pdf/useDocs';
import { usePdfJob } from '@/features/tools/pdf/usePdfJob';
import { cn } from '@/lib/cn';
import { downloadBlob } from '@/lib/download';
import { pluralize } from '@/lib/format';
import { notify } from '@/lib/toast';

type Item = { key: string; fileId: string; page: number; turn: number; selected: boolean };

export default function PdfPagesTool() {
  const [files, setFiles] = useState<LoadedPdf[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const job = usePdfJob();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const docs = useDocs(files);

  const add = async (picked: File[]) => {
    const { ok, problems: p } = await readPdfs(picked);
    setProblems(p);
    if (!ok.length) return;
    setFiles((cur) => [...cur, ...ok]);
    setItems((cur) => [
      ...cur,
      ...ok.flatMap((f) => Array.from({ length: f.pages }, (_, page) => ({ key: nextId('pg'), fileId: f.id, page, turn: 0, selected: false }))),
    ]);
  };

  // A file whose pages were all deleted is no longer part of the document: let go of its bytes and its pdf.js document
  // (both can be tens of megabytes) instead of holding them until "Start over".
  useEffect(() => {
    const inUse = new Set(items.map((i) => i.fileId));
    setFiles((cur) => (cur.every((f) => inUse.has(f.id)) ? cur : cur.filter((f) => inUse.has(f.id))));
  }, [items]);

  const selected = items.filter((i) => i.selected);
  const patch = (keys: Set<string>, fn: (i: Item) => Item) => setItems((cur) => cur.map((i) => (keys.has(i.key) ? fn(i) : i)));
  const targets = (key: string) => new Set(selected.length > 0 && items.find((i) => i.key === key)?.selected ? selected.map((i) => i.key) : [key]);

  /** Only the files the chosen pages come from are sent to the worker (extracting from one of five open files sends one). */
  const plan = (list: Item[]): { sources: Uint8Array[]; pages: PageRef[] } => {
    const ids = [...new Set(list.map((i) => i.fileId))];
    const sources = ids.map((id) => {
      const file = files.find((f) => f.id === id);
      if (!file) throw new Error('A page belongs to a file that is no longer open.');
      return file.bytes;
    });
    return { sources, pages: list.map((i) => ({ source: ids.indexOf(i.fileId), page: i.page, rotate: i.turn })) };
  };

  const save = (list: Item[], suffix: string) =>
    job.run(async (api) => {
      const { sources, pages } = plan(list);
      const { files: out } = await api.run({ op: 'assemble', sources, pages });
      const result = out[0];
      if (!result) throw new Error('Nothing was produced.');
      downloadBlob(`${files.length === 1 ? baseName(files[0]?.name ?? 'document') : 'document'}${suffix}.pdf`, pdfBlob(result));
      notify.success('Saved', pluralize(list.length, 'page'));
    }, 'Couldn’t save');

  const rotate = (keys: Set<string>, by: number) => patch(keys, (i) => ({ ...i, turn: (i.turn + by + 360) % 360 }));

  return (
    <div className="space-y-4">
      <FileDrop
        accept="application/pdf,.pdf"
        onFiles={add}
        title={files.length ? 'Add pages from another PDF' : 'Drop a PDF here, or click to choose'}
        hint="Rearrange, rotate, delete or pull out pages · stays on your device"
        compact={files.length > 0}
      />
      <Problems items={problems} />

      {items.length > 0 && (
        <>
          <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-lg border bg-card/90 p-2 backdrop-blur">
            <Button variant="ghost" size="sm" onClick={() => setItems((c) => c.map((i) => ({ ...i, selected: selected.length !== c.length })))}>
              {selected.length === items.length ? <CheckSquare /> : <Square />} {selected.length === items.length ? 'Select none' : 'Select all'}
            </Button>
            <span className="text-[13px] text-muted-foreground" role="status">
              {pluralize(items.length, 'page')}
              {selected.length > 0 && ` · ${selected.length} selected`}
            </span>
            <span className="ml-auto flex flex-wrap gap-1.5">
              <Button variant="outline" size="sm" disabled={!selected.length} onClick={() => rotate(new Set(selected.map((i) => i.key)), -90)}>
                <RotateCcw /> Left
              </Button>
              <Button variant="outline" size="sm" disabled={!selected.length} onClick={() => rotate(new Set(selected.map((i) => i.key)), 90)}>
                <RotateCw /> Right
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!selected.length || selected.length === items.length}
                onClick={() => setItems((c) => c.filter((i) => !i.selected))}
              >
                <Trash2 /> Delete
              </Button>
              <Button variant="outline" size="sm" onClick={() => setItems((c) => [...c].reverse())}>
                Reverse
              </Button>
            </span>
          </div>

          <ol className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }} aria-label="Pages, in output order">
            {items.map((it, idx) => {
              const doc = docs.get(it.fileId);
              const file = files.find((f) => f.id === it.fileId);
              return (
                <li
                  key={it.key}
                  draggable
                  onDragStart={() => setDragFrom(idx)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(idx);
                  }}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  onDrop={() => {
                    if (dragFrom !== null) setItems((c) => moveItem(c, dragFrom, idx));
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                  className={cn(
                    'group relative flex flex-col items-center gap-1.5 rounded-lg border bg-card p-2 transition-colors',
                    it.selected && 'border-brand bg-brand-soft',
                    dragOver === idx && dragFrom !== idx && 'ring-2 ring-brand',
                    dragFrom === idx && 'opacity-40',
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={it.selected}
                    aria-label={`Page ${idx + 1}${files.length > 1 ? ` from ${file?.name}` : ''}, ${it.selected ? 'selected' : 'not selected'}`}
                    onClick={() => patch(new Set([it.key]), (i) => ({ ...i, selected: !i.selected }))}
                    className="grid place-items-center outline-offset-2"
                  >
                    <span className="grid place-items-center" style={{ minHeight: 160 }}>
                      {doc ? <PageThumb doc={doc} index={it.page} width={118} turn={it.turn} /> : <span className="h-40 w-28 rounded-md bg-muted" />}
                    </span>
                  </button>
                  <span className="tabular text-xs text-muted-foreground">
                    {idx + 1}
                    {files.length > 1 && <span className="ml-1 text-subtle-foreground">· {file?.name.slice(0, 14)}</span>}
                  </span>
                  <span className="flex items-center gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <IconButton
                      label={`Move page ${idx + 1} earlier`}
                      size="icon-xs"
                      disabled={idx === 0}
                      onClick={() => setItems((c) => moveItem(c, idx, idx - 1))}
                    >
                      <span aria-hidden="true">‹</span>
                    </IconButton>
                    <IconButton label={`Rotate page ${idx + 1} left`} size="icon-xs" onClick={() => rotate(targets(it.key), -90)}>
                      <RotateCcw />
                    </IconButton>
                    <IconButton label={`Rotate page ${idx + 1} right`} size="icon-xs" onClick={() => rotate(targets(it.key), 90)}>
                      <RotateCw />
                    </IconButton>
                    <IconButton
                      label={`Delete page ${idx + 1}`}
                      size="icon-xs"
                      disabled={items.length === 1}
                      onClick={() => setItems((c) => c.filter((i) => !targets(it.key).has(i.key) || targets(it.key).size === c.length))}
                    >
                      <Trash2 />
                    </IconButton>
                    <IconButton
                      label={`Move page ${idx + 1} later`}
                      size="icon-xs"
                      disabled={idx === items.length - 1}
                      onClick={() => setItems((c) => moveItem(c, idx, idx + 1))}
                    >
                      <span aria-hidden="true">›</span>
                    </IconButton>
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="ghost"
              disabled={job.busy}
              onClick={() => {
                setFiles([]);
                setItems([]);
              }}
            >
              Start over
            </Button>
            <Button variant="outline" disabled={!selected.length || job.busy} onClick={() => void save(selected, '-extract')}>
              <FilePlus2 /> Download selected ({selected.length})
            </Button>
            <Button variant="primary" disabled={job.busy} onClick={() => void save(items, '-edited')}>
              <Download /> Download {pluralize(items.length, 'page')}
            </Button>
          </div>
          {job.busy && <JobProgress progress={job.progress} onCancel={job.cancel} />}
        </>
      )}
    </div>
  );
}
