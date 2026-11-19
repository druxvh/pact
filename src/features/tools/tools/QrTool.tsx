import { AlertTriangle, Download, ImageDown, QrCode } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { Button, GroupLabel, Input, Segmented, Select, Slider, Switch, Textarea } from '@/components/ui';
import { contrastRatio, parseColor } from '@/features/tools/lib/color';
import { type Ecc, type ModuleStyle, qrMatrix, qrPng, qrSvg, wifiPayload } from '@/features/tools/lib/qr';
import { Field } from '@/features/tools/ui';
import { spring } from '@/lib/motion';
import { notify } from '@/lib/toast';

type Mode = 'text' | 'wifi';
type Security = 'WPA' | 'WEP' | 'nopass';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function QrTool() {
  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState('https://pact.app');
  const [ssid, setSsid] = useState('');
  const [wifiPass, setWifiPass] = useState('');
  const [security, setSecurity] = useState<Security>('WPA');
  const [hidden, setHidden] = useState(false);
  const [ecc, setEcc] = useState<Ecc>('M');
  const [style, setStyle] = useState<ModuleStyle>('square');
  const [fg, setFg] = useState('#0a0a0a');
  const [bg, setBg] = useState('#ffffff');
  const [margin, setMargin] = useState(3);
  const [pxSize, setPxSize] = useState('1024');

  const payload = mode === 'text' ? text : ssid ? wifiPayload(ssid, wifiPass, security, hidden) : '';

  const { matrix, error } = useMemo(() => {
    if (!payload) return { matrix: null, error: null as string | null };
    try {
      return { matrix: qrMatrix(payload, ecc), error: null as string | null };
    } catch {
      return { matrix: null, error: 'That’s too much data for a QR code at this error-correction level. Shorten it or lower the level.' };
    }
  }, [payload, ecc]);

  const opts = useMemo(() => ({ ecc, style, fg, bg, margin }), [ecc, style, fg, bg, margin]);
  const svg = useMemo(() => (matrix ? qrSvg(matrix, opts, 512) : ''), [matrix, opts]);
  const src = svg ? `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` : '';

  const fgC = parseColor(fg);
  const bgC = parseColor(bg);
  const ratio = fgC && bgC ? contrastRatio(fgC, bgC) : 21;
  const inverted = fgC && bgC ? contrastRatio(fgC, { r: 255, g: 255, b: 255, a: 1 }) < contrastRatio(bgC, { r: 255, g: 255, b: 255, a: 1 }) : false;

  const savePng = async () => {
    if (!matrix) return;
    download(await qrPng(matrix, opts, Number(pxSize)), 'pact-qr.png');
  };
  const saveSvg = () => {
    if (!matrix) return;
    download(new Blob([qrSvg(matrix, opts, Number(pxSize))], { type: 'image/svg+xml' }), 'pact-qr.svg');
  };
  const copyPng = async () => {
    if (!matrix) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': await qrPng(matrix, opts, 1024) })]);
      notify.success('QR code copied as an image');
    } catch {
      notify.error('Couldn’t copy the image', 'Use Download PNG instead.');
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Segmented<Mode>
          aria-label="Content type"
          value={mode}
          onValueChange={setMode}
          options={[
            { value: 'text', label: 'Text / URL' },
            { value: 'wifi', label: 'Wi-Fi' },
          ]}
        />

        {mode === 'text' ? (
          <Field label="Content" hint={`${text.length} chars`}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus placeholder="https://… or any text" aria-label="QR content" />
          </Field>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Network name (SSID)" className="sm:col-span-2">
              <Input value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="My Wi-Fi" autoFocus />
            </Field>
            <Field label="Password">
              <Input
                value={wifiPass}
                onChange={(e) => setWifiPass(e.target.value)}
                disabled={security === 'nopass'}
                placeholder={security === 'nopass' ? 'Open network' : 'Password'}
              />
            </Field>
            <Field label="Security">
              <Select
                aria-label="Security type"
                value={security}
                onValueChange={setSecurity}
                options={[
                  { value: 'WPA', label: 'WPA / WPA2 / WPA3' },
                  { value: 'WEP', label: 'WEP' },
                  { value: 'nopass', label: 'None' },
                ]}
              />
            </Field>
            <label className="flex items-center gap-2 text-[13px] text-muted-foreground sm:col-span-2">
              <Switch checked={hidden} onCheckedChange={setHidden} aria-label="Hidden network" /> Hidden network
            </label>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Error correction" hint="higher survives damage, but is denser">
            <Segmented<Ecc>
              aria-label="Error correction level"
              fullWidth
              value={ecc}
              onValueChange={setEcc}
              options={[
                { value: 'L', label: 'L' },
                { value: 'M', label: 'M' },
                { value: 'Q', label: 'Q' },
                { value: 'H', label: 'H' },
              ]}
            />
          </Field>
          <Field label="Style">
            <Segmented<ModuleStyle>
              aria-label="Module style"
              fullWidth
              value={style}
              onValueChange={setStyle}
              options={[
                { value: 'square', label: 'Squares' },
                { value: 'dots', label: 'Dots' },
              ]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['Foreground', fg, setFg],
                ['Background', bg, setBg],
              ] as const
            ).map(([label, val, set]) => (
              <div key={label}>
                <GroupLabel>{label}</GroupLabel>
                <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md border bg-card/50 px-2 transition-colors hover:border-foreground/25">
                  <span className="size-5 rounded-md border" style={{ background: val }} />
                  <span className="font-mono text-xs">{val}</span>
                  <input type="color" aria-label={label} value={val} onChange={(e) => set(e.target.value)} className="sr-only" />
                </label>
              </div>
            ))}
          </div>
          <Field label={`Quiet zone: ${margin}`}>
            <Slider aria-label="Quiet zone" value={margin} min={1} max={8} onValueChange={setMargin} />
          </Field>
        </div>

        <AnimatePresence>
          {matrix && (ratio < 3 || inverted) && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-start gap-2 overflow-hidden rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning-text"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {ratio < 3 ? 'Low contrast — some scanners may fail to read this code.' : 'Light-on-dark (inverted) codes aren’t supported by every scanner app.'}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="space-y-4">
        <div className="grid aspect-square place-items-center overflow-hidden rounded-lg border bg-white p-3 shadow-sm" style={{ background: bg }}>
          <AnimatePresence mode="wait" initial={false}>
            {src ? (
              <motion.img
                key={src.length + fg + bg + style}
                src={src}
                alt="Generated QR code"
                initial={{ opacity: 0, scale: 0.94, filter: 'blur(6px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0 }}
                transition={spring.soft}
                className="size-full object-contain"
                draggable={false}
              />
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center gap-2 text-center text-neutral-400"
              >
                <QrCode className="size-16" strokeWidth={1.2} />
                <p className="max-w-[16ch] text-[13px]">{error ?? (mode === 'wifi' ? 'Enter a network name' : 'Type something to encode')}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="grid grid-cols-[1fr_auto] items-center gap-2">
          <Select
            size="sm"
            aria-label="Download size"
            value={pxSize}
            onValueChange={setPxSize}
            options={[
              { value: '512', label: '512 px' },
              { value: '1024', label: '1024 px' },
              { value: '2048', label: '2048 px' },
            ]}
          />
          <Button variant="outline" size="md" disabled={!matrix} onClick={() => void copyPng()}>
            <ImageDown /> Copy
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="primary" disabled={!matrix} onClick={() => void savePng()}>
            <Download /> PNG
          </Button>
          <Button variant="secondary" disabled={!matrix} onClick={saveSvg}>
            <Download /> SVG
          </Button>
        </div>
      </div>
    </div>
  );
}

export default QrTool;
