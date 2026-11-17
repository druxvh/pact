import { ArrowLeft, ArrowRight, Download, RotateCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, IconButton, Segmented } from '@/components/ui';
import { inBand } from '@/features/tools/lib/pdf/job';
import type { ImageInput, ImagePageSize } from '@/features/tools/lib/pdf/types';
import { FileDrop, Problems } from '@/features/tools/pdf/FileDrop';
import { nextId, pdfBlob } from '@/features/tools/pdf/files';
import { type PreparedImage, prepareImage, turnImage } from '@/features/tools/pdf/images';
import { JobProgress } from '@/features/tools/pdf/JobProgress';
import { moveItem } from '@/features/tools/pdf/order';
import { usePdfJob } from '@/features/tools/pdf/usePdfJob';
import { Field } from '@/features/tools/ui';
import { downloadBlob } from '@/lib/download';
import { formatBytes, pluralize } from '@/lib/format';
import { notify } from '@/lib/toast';

type Item = PreparedImage & { id: string; turn: number };

const MARGINS = { none: 0, small: 18, large: 36 } as const;

export default function ImagesToPdfTool() {
  const [items, setItems] = useState<Item[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [size, setSize] = useState<ImagePageSize>('a4');
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [margin, setMargin] = useState<keyof typeof MARGINS>('small');
  const job = usePdfJob();
  const live = useRef<Item[]>([]);
  live.current = items;
  useEffect(
    () => () => {
      for (const i of live.current) URL.revokeObjectURL(i.url);
    },
    [],
  );

  const add = async (files: File[]) => {
    const added: Item[] = [];
    const bad: string[] = [];
    for (const f of files) {
      try {
        added.push({ ...(await prepareImage(f)), id: nextId('img'), turn: 0 });
      } catch (err) {
        bad.push(`${f.name}: ${err instanceof Error ? err.message : 'couldn’t be used.'}`);
      }
    }
    setProblems(bad);
    if (added.length) setItems((c) => [...c, ...added]);
  };

  const remove = (id: string) =>
    setItems((c) => {
      const gone = c.find((i) => i.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return c.filter((i) => i.id !== id);
    });

  const convert = () =>
    job.run(async (api) => {
      // Rotated images are re-encoded on the page (it needs a canvas); the PDF itself is built in the worker.
      const inputs: ImageInput[] = [];
      for (const [n, item] of items.entries()) {
        api.step(inBand({ done: n, total: items.length, label: `Preparing image ${n + 1} of ${items.length}` }, 0, 0.3));
        inputs.push(await turnImage(item, item.turn));
      }
      const { files: out } = await api.run({ op: 'images', images: inputs, options: { size, margin: MARGINS[margin], orientation } }, [0.3, 1]);
      const pdf = out[0];
      if (!pdf) throw new Error('Nothing was produced.');
      downloadBlob('images.pdf', pdfBlob(pdf));
      notify.success('PDF ready', `${pluralize(items.length, 'page')} · ${formatBytes(pdf.length)}`);
    }, 'Couldn’t make the PDF');

  return (
    <div className="space-y-4">
      <FileDrop
        accept="image/*"
        onFiles={add}
        title={items.length ? 'Add more images' : 'Drop images here, or click to choose'}
        hint="JPG, PNG, WebP, GIF… one image per page · stays on your device"
        compact={items.length > 0}
      />
      <Problems items={problems} />

      {items.length > 0 && (
        <>
          <div className="grid gap-4 rounded-lg border bg-card p-3 sm:grid-cols-3">
            <Field label="Page size">
              <Segmented<ImagePageSize>
                aria-label="Page size"
                value={size}
                onValueChange={setSize}
                options={[
                  { value: 'a4', label: 'A4' },
                  { value: 'letter', label: 'Letter' },
                  { value: 'fit', label: 'Fit image' },
                ]}
              />
            </Field>
            <Field label="Orientation" hint={size === 'fit' ? 'n/a' : undefined}>
              <Segmented
                aria-label="Orientation"
                value={orientation}
                onValueChange={setOrientation}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'portrait', label: 'Portrait' },
                  { value: 'landscape', label: 'Landscape' },
                ]}
              />
            </Field>
            <Field label="Margin">
              <Segmented<keyof typeof MARGINS>
                aria-label="Margin"
                value={margin}
                onValueChange={setMargin}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'small', label: 'Small' },
                  { value: 'large', label: 'Large' },
                ]}
              />
            </Field>
          </div>

          <ol className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }} aria-label="Images, one per page, in order">
            {items.map((it, idx) => (
              <li key={it.id} className="flex flex-col items-center gap-1.5 rounded-lg border bg-card p-2">
                <span className="grid h-36 w-full place-items-center overflow-hidden rounded-md bg-muted">
                  <img
                    src={it.url}
                    alt={`Page ${idx + 1}: ${it.name}`}
                    className="max-h-36 max-w-full object-contain transition-transform duration-200"
                    style={{ transform: `rotate(${it.turn}deg) scale(${it.turn % 180 !== 0 ? Math.min(1, it.width / it.height) : 1})` }}
                  />
                </span>
                <span className="w-full truncate text-center text-xs text-muted-foreground" title={it.name}>
                  {idx + 1}. {it.name}
                </span>
                <span className="flex items-center gap-0.5">
                  <IconButton label={`Move ${it.name} earlier`} size="icon-xs" disabled={idx === 0} onClick={() => setItems((c) => moveItem(c, idx, idx - 1))}>
                    <ArrowLeft />
                  </IconButton>
                  <IconButton
                    label={`Rotate ${it.name}`}
                    size="icon-xs"
                    onClick={() => setItems((c) => c.map((x) => (x.id === it.id ? { ...x, turn: (x.turn + 90) % 360 } : x)))}
                  >
                    <RotateCw />
                  </IconButton>
                  <IconButton label={`Remove ${it.name}`} size="icon-xs" onClick={() => remove(it.id)}>
                    <X />
                  </IconButton>
                  <IconButton
                    label={`Move ${it.name} later`}
                    size="icon-xs"
                    disabled={idx === items.length - 1}
                    onClick={() => setItems((c) => moveItem(c, idx, idx + 1))}
                  >
                    <ArrowRight />
                  </IconButton>
                </span>
              </li>
            ))}
          </ol>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={job.busy}
              onClick={() => {
                for (const i of items) URL.revokeObjectURL(i.url);
                setItems([]);
              }}
            >
              Clear
            </Button>
            <Button variant="primary" disabled={job.busy} onClick={() => void convert()}>
              <Download /> Make PDF ({pluralize(items.length, 'page')})
            </Button>
          </div>
          {job.busy && <JobProgress progress={job.progress} onCancel={job.cancel} />}
        </>
      )}
    </div>
  );
}
