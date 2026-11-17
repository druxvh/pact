import { ChevronLeft, ChevronRight, Download, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, IconButton, Input, Segmented, Switch } from '@/components/ui';
import { type FRect, fractionAspect, heightForWidth } from '@/features/tools/lib/pdf/geometry';
import { FileDrop, Problems } from '@/features/tools/pdf/FileDrop';
import { baseName, type LoadedPdf, nextId, pdfBlob, readPdfs } from '@/features/tools/pdf/files';
import { JobProgress } from '@/features/tools/pdf/JobProgress';
import { PagePreview } from '@/features/tools/pdf/PagePreview';
import { RectBox } from '@/features/tools/pdf/RectBox';
import { type Signature, signatureFromCanvas, signatureFromImage } from '@/features/tools/pdf/signature';
import { useDocs } from '@/features/tools/pdf/useDocs';
import { usePdfJob } from '@/features/tools/pdf/usePdfJob';
import { Field } from '@/features/tools/ui';
import { downloadBlob } from '@/lib/download';
import { notify } from '@/lib/toast';

type Placement = { id: string; page: number; rect: FRect; sig: Signature };

const INKS = { black: '#111111', blue: '#1d3fbb' } as const;
const TYPED = [
  { id: 'script', label: 'Script', font: '"Snell Roundhand","Segoe Script","Brush Script MT","Apple Chancery","Lucida Handwriting",cursive', style: 'italic' },
  { id: 'marker', label: 'Marker', font: '"Bradley Hand","Marker Felt","Segoe Print","Comic Sans MS",cursive', style: 'normal' },
  { id: 'serif', label: 'Classic', font: 'Georgia,"Times New Roman",serif', style: 'italic' },
] as const;

/** Draw, type or upload a signature. Calls `onReady` with a trimmed transparent PNG. */
function SignatureMaker({ onReady }: { onReady: (s: Signature) => void }) {
  const [mode, setMode] = useState<'draw' | 'type' | 'upload'>('draw');
  const [ink, setInk] = useState<keyof typeof INKS>('black');
  const [text, setText] = useState('');
  const [face, setFace] = useState<(typeof TYPED)[number]['id']>('script');
  const [empty, setEmpty] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pad = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const mid = useRef<{ x: number; y: number } | null>(null); // end of the last drawn curve

  const clear = () => {
    const c = pad.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  };

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = point(e);
    mid.current = last.current;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = INKS[ink];
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 2, 0, Math.PI * 2);
    ctx.fill();
    setEmpty(false);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const from = last.current;
    const start = mid.current;
    if (!from || !start) return;
    const to = point(e);
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const end = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    ctx.strokeStyle = INKS[ink];
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(from.x, from.y, end.x, end.y); // from midpoint to midpoint, through the sample: smooth and gap-free
    ctx.stroke();
    last.current = to;
    mid.current = end;
  };
  const lift = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const from = last.current;
    const start = mid.current;
    const ctx = e.currentTarget.getContext('2d');
    if (ctx && from && start) {
      ctx.strokeStyle = INKS[ink];
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(from.x, from.y); // finish the stroke at the last point
      ctx.stroke();
    }
    last.current = null;
    mid.current = null;
  };

  const submitDrawn = async () => {
    if (!pad.current) return;
    const sig = await signatureFromCanvas(pad.current, nextId('sig'));
    if (sig) onReady(sig);
    else setError('Draw your signature first.');
  };

  const submitTyped = async () => {
    const t = text.trim();
    if (!t) return setError('Type your name first.');
    const f = TYPED.find((x) => x.id === face) ?? TYPED[0];
    const c = document.createElement('canvas');
    c.width = 1100;
    c.height = 260;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.fillStyle = INKS[ink];
    ctx.textBaseline = 'middle';
    let size = 150;
    ctx.font = `${f.style} ${size}px ${f.font}`;
    while (ctx.measureText(t).width > 1040 && size > 30) {
      size -= 6;
      ctx.font = `${f.style} ${size}px ${f.font}`;
    }
    ctx.fillText(t, 30, 130);
    const sig = await signatureFromCanvas(c, nextId('sig'));
    if (sig) onReady(sig);
  };

  const submitUploaded = async (file: File | undefined) => {
    if (!file) return;
    try {
      const sig = await signatureFromImage(file, nextId('sig'));
      if (sig) onReady(sig);
      else setError('We couldn’t find any ink in that picture.');
    } catch {
      setError('That image couldn’t be read.');
    }
  };

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <Segmented
        aria-label="How to make your signature"
        value={mode}
        onValueChange={(m) => {
          setMode(m);
          setError(null);
        }}
        options={[
          { value: 'draw', label: 'Draw' },
          { value: 'type', label: 'Type' },
          { value: 'upload', label: 'Upload' },
        ]}
      />
      {mode !== 'upload' && (
        <Field label="Ink">
          <Segmented
            aria-label="Ink colour"
            value={ink}
            onValueChange={setInk}
            options={[
              { value: 'black', label: 'Black' },
              { value: 'blue', label: 'Blue' },
            ]}
          />
        </Field>
      )}

      {mode === 'draw' && (
        <>
          <canvas
            ref={pad}
            width={720}
            height={240}
            role="img"
            aria-label="Signature pad: draw with your mouse, finger or pen"
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={lift}
            onPointerCancel={lift}
            className="h-40 w-full cursor-crosshair touch-none rounded-md border border-dashed bg-white"
          />
          <div className="flex justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={clear} disabled={empty}>
              Clear
            </Button>
            <Button variant="primary" size="sm" disabled={empty} onClick={() => void submitDrawn()}>
              Use this signature
            </Button>
          </div>
        </>
      )}

      {mode === 'type' && (
        <>
          <Input aria-label="Your name" placeholder="Your name" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} />
          <div className="grid grid-cols-3 gap-2">
            {TYPED.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={face === f.id}
                onClick={() => setFace(f.id)}
                className={`truncate rounded-md border bg-white px-2 py-2 text-lg text-neutral-900 ${face === f.id ? 'border-brand ring-2 ring-brand/30' : ''}`}
                style={{ fontFamily: f.font, fontStyle: f.style }}
              >
                {text.trim() || f.label}
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <Button variant="primary" size="sm" disabled={!text.trim()} onClick={() => void submitTyped()}>
              Use this signature
            </Button>
          </div>
        </>
      )}

      {mode === 'upload' && (
        <div className="space-y-2">
          <label className="block text-[13px] text-muted-foreground">
            A photo or scan of your signature on white paper. The paper is removed automatically.
            <input
              type="file"
              accept="image/*"
              className="mt-2 block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-[13px]"
              onChange={(e) => void submitUploaded(e.target.files?.[0])}
            />
          </label>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}

export default function PdfSignTool() {
  const [file, setFile] = useState<LoadedPdf | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [ratio, setRatio] = useState(1.41);
  const [sig, setSig] = useState<Signature | null>(null);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [everyPage, setEveryPage] = useState(false);
  const job = usePdfJob();
  const doc = useDocs(file ? [file] : []).get(file?.id ?? '');
  // Every signature the person makes gets an object URL for its preview. Revoke the ones nothing shows any more (a
  // replaced signature, a removed placement) and all of them when the tool closes.
  const urls = useRef<string[]>([]);
  useEffect(() => {
    const inUse = new Set([sig?.url, ...placements.map((p) => p.sig.url)]);
    urls.current = urls.current.filter((u) => {
      if (inUse.has(u)) return true;
      URL.revokeObjectURL(u);
      return false;
    });
  }, [sig, placements]);
  useEffect(() => {
    return () => {
      for (const u of urls.current) URL.revokeObjectURL(u);
      urls.current = [];
    };
  }, []);

  const load = async (picked: File[]) => {
    const { ok, problems: p } = await readPdfs(picked.slice(0, 1));
    setProblems(p);
    if (ok[0]) {
      setFile(ok[0]);
      setPage(0);
      setPlacements([]);
    }
  };

  const made = (s: Signature) => {
    urls.current.push(s.url);
    setSig(s);
    place(s);
  };

  // A fresh signature lands near the bottom of the current page at a natural size (about a third of the width).
  const place = (s: Signature | null = sig) => {
    if (!s) return;
    const width = 0.32;
    const height = heightForWidth(width, s.ratio, ratio);
    const rect: FRect = { left: 0.55, top: Math.max(0, Math.min(1 - height, 0.8 - height / 2)), width, height };
    const p: Placement = { id: nextId('pl'), page, rect, sig: s };
    setPlacements((c) => [...c, p]);
    setSelected(p.id);
  };

  const update = (id: string, rect: FRect) => setPlacements((c) => c.map((p) => (p.id === id ? { ...p, rect } : p)));
  const here = placements.filter((p) => p.page === page);

  const download = async () => {
    if (!file) return;
    const list = everyPage
      ? Array.from({ length: file.pages }, (_, i) => placements.filter((p) => p.page === page).map((p) => ({ page: i, rect: p.rect, png: p.sig.png }))).flat()
      : placements.map((p) => ({ page: p.page, rect: p.rect, png: p.sig.png }));
    await job.run(async (api) => {
      const { files: out } = await api.run({ op: 'sign', bytes: file.bytes, placements: list });
      const signed = out[0];
      if (!signed) throw new Error('Nothing was produced.');
      downloadBlob(`${baseName(file.name)}-signed.pdf`, pdfBlob(signed));
      notify.success('Signed PDF saved');
    }, 'Couldn’t sign');
  };

  return (
    <div className="space-y-4">
      {!file ? (
        <FileDrop
          accept="application/pdf,.pdf"
          multiple={false}
          onFiles={load}
          title="Drop a PDF here, or click to choose"
          hint="Draw, type or upload a signature and place it · stays on your device"
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
              <PagePreview doc={doc} index={page} onRatio={setRatio}>
                {here.map((p) => (
                  <RectBox
                    key={p.id}
                    rect={p.rect}
                    onChange={(r) => update(p.id, r)}
                    label={`Signature on page ${page + 1}`}
                    lockAspect={fractionAspect(p.sig.ratio, ratio)}
                    selected={selected === p.id}
                    onSelect={() => setSelected(p.id)}
                  >
                    <img src={p.sig.url} alt="" draggable={false} className="size-full object-contain" />
                  </RectBox>
                ))}
              </PagePreview>
            )}
          </div>

          <div className="space-y-4">
            <SignatureMaker onReady={made} />
            {sig && (
              <div className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
                <span className="grid h-10 flex-1 place-items-center rounded-md bg-white px-2">
                  <img src={sig.url} alt="Your signature" className="max-h-8 max-w-full object-contain" />
                </span>
                <Button variant="outline" size="sm" onClick={() => place()}>
                  <Plus /> Place on page {page + 1}
                </Button>
              </div>
            )}
            {here.length > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
                <span className="text-[13px] text-muted-foreground">
                  {here.length === 1 ? '1 signature on this page' : `${here.length} signatures on this page`}
                </span>
                <IconButton
                  label="Remove selected signature"
                  size="icon-sm"
                  disabled={!selected || !here.some((p) => p.id === selected)}
                  onClick={() => {
                    setPlacements((c) => c.filter((p) => p.id !== selected));
                    setSelected(null);
                  }}
                >
                  <Trash2 />
                </IconButton>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 rounded-lg border p-2.5">
              <label htmlFor="sign-all" className="text-[13px]">
                Put this page’s signatures on every page
              </label>
              <Switch id="sign-all" checked={everyPage} onCheckedChange={setEveryPage} aria-label="Put this page’s signatures on every page" />
            </div>
            {job.busy ? (
              <JobProgress stacked progress={job.progress} onCancel={job.cancel} />
            ) : (
              <Button variant="primary" className="w-full" disabled={placements.length === 0} onClick={() => void download()}>
                <Download /> Download signed PDF
              </Button>
            )}
            <Button
              variant="ghost"
              className="w-full"
              disabled={job.busy}
              onClick={() => {
                setFile(null);
                setPlacements([]);
              }}
            >
              Choose another file
            </Button>
            <p className="text-xs leading-relaxed text-subtle-foreground">
              This stamps a picture of your signature onto the page. It isn’t a certified digital signature (no certificate or tamper protection) — fine for
              forms and letters, not for anything that legally requires a qualified e-signature.
            </p>
          </div>
        </div>
      )}
      <Problems items={problems} />
    </div>
  );
}
