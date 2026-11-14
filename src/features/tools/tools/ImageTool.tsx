import { ArrowRight, Download, ImagePlus, RefreshCw, TrendingDown, TrendingUp, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, IconButton, Segmented, Select, Slider, Spinner, Switch } from '@/components/ui';
import { type CompressResult, compressImage, extensionFor, type OutputFormat } from '@/features/tools/lib/image';
import { Field } from '@/features/tools/ui';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/format';
import { spring } from '@/lib/motion';
import { notify } from '@/lib/toast';

const FIVE_MB = 5 * 1024 * 1024;
const MAX_INPUT = 60 * 1024 * 1024;

type Loaded = { file: File; url: string; width: number; height: number };
type Done = CompressResult & { url: string };

function readDims(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('decode'));
    img.src = url;
  });
}

export function ImageTool() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [result, setResult] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [format, setFormat] = useState<OutputFormat>('original');
  const [quality, setQuality] = useState(80);
  const [maxDim, setMaxDim] = useState('0');
  const [underFive, setUnderFive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const run = useRef(0);

  const load = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      notify.error(
        'Unsupported file',
        file.type === 'image/gif'
          ? 'GIFs can’t be compressed here without losing their animation.'
          : file.type === 'image/svg+xml'
            ? 'SVGs are already vector — there’s nothing to compress.'
            : 'Choose a JPEG, PNG or WebP image.',
      );
      return;
    }
    if (file.size > MAX_INPUT) {
      notify.error('That image is too large', `Please pick one under ${formatBytes(MAX_INPUT)}.`);
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const dims = await readDims(url);
      setLoaded((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { file, url, ...dims };
      });
      setResult((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return null;
      });
    } catch {
      URL.revokeObjectURL(url);
      notify.error('Couldn’t read that image', 'It may be corrupted or in an unsupported format.');
    }
  }, []);

  // Paste an image straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (f) void load(f);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [load]);

  // Recompress (debounced, latest-wins) whenever the image or options change.
  useEffect(() => {
    if (!loaded) return;
    const id = ++run.current;
    setBusy(true);
    const t = window.setTimeout(async () => {
      try {
        const r = await compressImage(loaded.file, {
          format,
          quality: quality / 100,
          maxDimension: Number(maxDim),
          targetBytes: underFive ? FIVE_MB : undefined,
        });
        if (id !== run.current) return;
        const url = URL.createObjectURL(r.blob);
        setResult((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          return { ...r, url };
        });
      } catch {
        if (id === run.current) notify.error('Compression failed', 'Try a different format.');
      } finally {
        if (id === run.current) setBusy(false);
      }
    }, 220);
    return () => window.clearTimeout(t);
  }, [loaded, format, quality, maxDim, underFive]);

  // Free both object URLs when the tool unmounts.
  const urls = useRef<{ original?: string; result?: string }>({});
  useEffect(() => {
    urls.current = { original: loaded?.url, result: result?.url };
  }, [loaded, result]);
  useEffect(
    () => () => {
      if (urls.current.original) URL.revokeObjectURL(urls.current.original);
      if (urls.current.result) URL.revokeObjectURL(urls.current.result);
    },
    [],
  );

  const saved = loaded && result ? Math.round((1 - result.blob.size / loaded.file.size) * 100) : 0;
  const bigger = saved < 0;

  const save = () => {
    if (!loaded || !result) return;
    const base = loaded.file.name.replace(/\.[^.]+$/, '');
    const a = document.createElement('a');
    a.href = result.url;
    a.download = `${base}-compressed.${extensionFor(result.mime)}`;
    a.click();
  };

  if (!loaded) {
    return (
      <div>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the inner button handles keyboard activation */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: drop zone — drag & drop is an enhancement over the button inside */}
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void load(e.dataTransfer.files[0]);
          }}
          className={cn(
            'flex min-h-72 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-[border-color,background-color,transform] duration-200',
            over ? 'scale-[1.01] border-brand bg-brand-soft' : 'hover:border-foreground/30 hover:bg-accent/50',
          )}
        >
          <motion.span
            animate={over ? { y: -6, scale: 1.1 } : { y: 0, scale: 1 }}
            transition={spring.bouncy}
            className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand-text"
          >
            <ImagePlus className="size-7" />
          </motion.span>
          <div>
            <p className="text-sm font-medium">{over ? 'Drop it here' : 'Drop an image, paste, or browse'}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">JPEG, PNG or WebP · compressed on this device — nothing is uploaded</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            Choose file
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => void load(e.target.files?.[0])}
            aria-label="Choose an image"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid items-stretch gap-4 md:grid-cols-[1fr_auto_1fr]">
        <figure className="overflow-hidden rounded-2xl border bg-card">
          <div className="grid h-56 place-items-center bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
            <img src={loaded.url} alt="Original" className="max-h-full max-w-full object-contain" />
          </div>
          <figcaption className="flex items-center justify-between gap-2 border-t px-3 py-2 text-[13px]">
            <span className="min-w-0 truncate font-medium" title={loaded.file.name}>
              {loaded.file.name}
            </span>
            <span className="tabular shrink-0 text-muted-foreground">
              {formatBytes(loaded.file.size)} · {loaded.width}×{loaded.height}
            </span>
          </figcaption>
        </figure>

        <div className="grid place-items-center">
          <span className="grid size-9 place-items-center rounded-full bg-muted text-muted-foreground max-md:rotate-90">
            {busy ? <Spinner /> : <ArrowRight className="size-4" />}
          </span>
        </div>

        <figure className={cn('overflow-hidden rounded-2xl border bg-card transition-opacity', busy && 'opacity-70')}>
          <div className="grid h-56 place-items-center bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
            {result ? <img src={result.url} alt="Compressed preview" className="max-h-full max-w-full object-contain" /> : <Spinner className="size-6" />}
          </div>
          <figcaption className="flex items-center justify-between gap-2 border-t px-3 py-2 text-[13px]">
            <AnimatePresence mode="wait" initial={false}>
              {result && (
                <motion.span key={saved} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <Badge tone={bigger ? 'warning' : 'success'}>
                    {bigger ? <TrendingUp /> : <TrendingDown />}
                    {bigger ? `${Math.abs(saved)}% larger` : `${saved}% smaller`}
                  </Badge>
                </motion.span>
              )}
            </AnimatePresence>
            <span className="tabular text-muted-foreground">{result ? `${formatBytes(result.blob.size)} · ${result.width}×${result.height}` : '…'}</span>
          </figcaption>
        </figure>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Format">
          <Segmented<OutputFormat>
            aria-label="Output format"
            size="sm"
            value={format}
            onValueChange={setFormat}
            options={[
              { value: 'original', label: 'Auto' },
              { value: 'jpeg', label: 'JPG' },
              { value: 'webp', label: 'WebP' },
              { value: 'png', label: 'PNG' },
            ]}
          />
        </Field>
        <Field label={`Quality: ${quality}%`} hint={format === 'png' ? 'PNG is lossless' : undefined}>
          <Slider
            aria-label="Quality"
            value={quality}
            min={10}
            max={100}
            onValueChange={setQuality}
            className={cn(format === 'png' && 'pointer-events-none opacity-40')}
          />
        </Field>
        <Field label="Max dimension">
          <Select
            size="sm"
            aria-label="Max dimension"
            value={maxDim}
            onValueChange={setMaxDim}
            options={[
              { value: '0', label: 'Original size' },
              { value: '3840', label: '3840 px (4K)' },
              { value: '2560', label: '2560 px' },
              { value: '1920', label: '1920 px (Full HD)' },
              { value: '1280', label: '1280 px' },
              { value: '800', label: '800 px' },
            ]}
          />
        </Field>
        <Field label="Chat-ready">
          <label className="flex h-8 items-center gap-2 text-[13px] text-muted-foreground">
            <Switch checked={underFive} onCheckedChange={setUnderFive} aria-label="Fit under 5 MB" />
            Fit under 5 MB
          </label>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="lg" disabled={!result || busy} onClick={save}>
          <Download /> Download
        </Button>
        <Button variant="outline" size="lg" onClick={() => inputRef.current?.click()}>
          <RefreshCw /> Another image
        </Button>
        <IconButton
          label="Remove image"
          variant="danger"
          size="icon-lg"
          onClick={() => {
            URL.revokeObjectURL(loaded.url);
            if (result) URL.revokeObjectURL(result.url);
            setLoaded(null);
            setResult(null);
          }}
        >
          <X />
        </IconButton>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={(e) => void load(e.target.files?.[0])}
          aria-label="Choose another image"
        />
        {result && result.iterations > 1 && (
          <span className="text-xs text-muted-foreground">Tuned over {result.iterations} passes to reach the size target.</span>
        )}
      </div>
    </div>
  );
}

export default ImageTool;
