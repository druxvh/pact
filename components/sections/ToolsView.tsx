import { useState } from 'react';
import { Calculator, CaseSensitive, Link2, Palette, QrCode, Image as ImageIcon, Ruler, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

type ToolId = 'calc' | 'text' | 'url' | 'color' | 'convert' | 'qr' | 'image';

const TOOLS: Array<{ id: ToolId; icon: any; title: string; desc: string }> = [
  { id: 'calc', icon: Calculator, title: 'Calculator', desc: 'Quick calc, history' },
  { id: 'text', icon: CaseSensitive, title: 'Text case', desc: 'lower → UPPER' },
  { id: 'url', icon: Link2, title: 'URL tools', desc: 'encode / decode' },
  { id: 'color', icon: Palette, title: 'Colors', desc: 'picker + contrast' },
  { id: 'convert', icon: Ruler, title: 'Converters', desc: 'x → y units' },
  { id: 'qr', icon: QrCode, title: 'QR maker', desc: 'text → QR' },
  { id: 'image', icon: ImageIcon, title: 'Image', desc: 'compress ≤5mb' },
];

export function ToolsView() {
  const [active, setActive] = useState<ToolId>('calc');

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Utility tools</h2>
        <p className="text-xs text-muted-foreground">Tiny, local-first helpers — all mock, all working, no server.</p>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ staggerChildren: 0.04 }} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {TOOLS.map((t) => (
          <motion.button key={t.id} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }} onClick={() => setActive(t.id)} className="text-left">
            <Card className={`group flex items-start gap-3 transition-colors ${active === t.id ? 'border-primary bg-accent' : 'hover:border-ring/50'}`}>
              <div className={`flex h-8 w-8 items-center justify-center rounded-sm border ${active === t.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground group-hover:border-ring'}`}>
                <t.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 text-sm font-medium text-foreground">
                  {t.title} {active === t.id && <ChevronRight className="h-3 w-3" />}
                </p>
                <p className="text-xs text-muted-foreground">{t.desc}</p>
              </div>
            </Card>
          </motion.button>
        ))}
      </motion.div>

      <Card className="min-h-[260px] overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            {active === 'calc' && <CalcTool />}
            {active === 'text' && <TextTool />}
            {active === 'url' && <UrlTool />}
            {active === 'color' && <ColorTool />}
            {active === 'convert' && <ConvertTool />}
            {active === 'qr' && <QrTool />}
            {active === 'image' && <ImageTool />}
          </motion.div>
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}

function CalcTool() {
  const [expr, setExpr] = useState('12*4+8');
  const [history, setHistory] = useState<string[]>(['12*4+8 = 56']);
  const result = (() => {
    try {
      const v = Function(`"use strict"; return (${expr})`)();
      return String(v);
    } catch {
      return '—';
    }
  })();
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Calculator</h3>
      <div className="flex gap-2">
        <input value={expr} onChange={(e) => setExpr(e.target.value)} className="flex-1 rounded-sm border border-input bg-background px-3 py-2 font-mono text-sm outline-none transition-colors focus:border-ring" />
        <Button onClick={() => setHistory((h) => [`${expr} = ${result}`, ...h].slice(0, 8))} className="rounded-sm">=</Button>
      </div>
      <div className="rounded-sm border border-border bg-muted p-3">
        <p className="font-mono text-lg text-foreground">{result}</p>
        <p className="text-xs text-muted-foreground">live eval — local only</p>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">History</p>
        <ul className="space-y-1 text-xs font-mono text-foreground">
          {history.map((h, i) => (
            <li key={i} className="rounded-sm border border-border bg-background px-2 py-1">{h}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TextTool() {
  const [text, setText] = useState('Hello pact — fun community product');
  const actions = [
    { label: 'UPPER', fn: (s: string) => s.toUpperCase() },
    { label: 'lower', fn: (s: string) => s.toLowerCase() },
    { label: 'Title', fn: (s: string) => s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) },
    { label: 'slug', fn: (s: string) => s.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') },
    { label: 'reverse', fn: (s: string) => s.split('').reverse().join('') },
  ];
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Text case</h3>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="w-full rounded-sm border border-input bg-background p-3 text-sm outline-none transition-colors focus:border-ring" />
      <div className="flex flex-wrap gap-1.5">
        {actions.map((a) => (
          <Button key={a.label} variant="secondary" size="sm" className="rounded-sm" onClick={() => setText(a.fn(text))}>{a.label}</Button>
        ))}
        <Button variant="ghost" size="sm" className="rounded-sm" onClick={() => navigator.clipboard.writeText(text)}>Copy</Button>
      </div>
      <p className="text-xs text-muted-foreground">{text.length} chars · {text.split(/\s+/).filter(Boolean).length} words</p>
    </div>
  );
}

function UrlTool() {
  const [input, setInput] = useState('https://pact.app/search?q=hello world & pact=fun');
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const out = (() => {
    try { return mode === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input); } catch { return 'Invalid input'; }
  })();
  const slug = input.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">URL tools</h3>
      <div className="flex gap-1.5">
        <Button variant={mode === 'encode' ? 'primary' : 'ghost'} size="sm" className="rounded-sm" onClick={() => setMode('encode')}>Encode</Button>
        <Button variant={mode === 'decode' ? 'primary' : 'ghost'} size="sm" className="rounded-sm" onClick={() => setMode('decode')}>Decode</Button>
      </div>
      <input value={input} onChange={(e) => setInput(e.target.value)} className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring" />
      <div className="rounded-sm border border-border bg-muted p-3">
        <p className="break-all font-mono text-xs text-foreground">{out}</p>
      </div>
      <div className="rounded-sm border border-dashed border-border p-3">
        <p className="text-xs font-medium text-foreground">Slugify</p>
        <p className="font-mono text-sm text-muted-foreground">{slug || '—'}</p>
      </div>
    </div>
  );
}

function ColorTool() {
  const [color, setColor] = useState('#0a0a0a');
  const [bg, setBg] = useState('#ffffff');
  const contrast = (() => {
    const l = (hex: string) => {
      const h = hex.replace('#','');
      const r = parseInt(h.slice(0,2),16)/255, g=parseInt(h.slice(2,4),16)/255, b=parseInt(h.slice(4,6),16)/255;
      const toL = (c:number) => c<=0.03928? c/12.92: Math.pow((c+0.055)/1.055,2.4);
      return 0.2126*toL(r)+0.7152*toL(g)+0.0722*toL(b);
    };
    const la = l(color), lb = l(bg);
    const ratio = (Math.max(la,lb)+0.05)/(Math.min(la,lb)+0.05);
    return ratio.toFixed(2);
  })();
  const pass = parseFloat(contrast) >= 4.5;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Colors</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Foreground</label>
          <div className="flex items-center gap-2">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 rounded-sm border border-border bg-background p-1" />
            <input value={color} onChange={(e) => setColor(e.target.value)} className="flex-1 rounded-sm border border-input bg-background px-3 py-2 font-mono text-sm outline-none" />
          </div>
          <label className="text-xs text-muted-foreground">Background</label>
          <div className="flex items-center gap-2">
            <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="h-9 w-12 rounded-sm border border-border bg-background p-1" />
            <input value={bg} onChange={(e) => setBg(e.target.value)} className="flex-1 rounded-sm border border-input bg-background px-3 py-2 font-mono text-sm outline-none" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="rounded-sm border border-border p-4" style={{ background: bg, color: color }}>
            <p className="text-sm font-medium">Aa — preview text</p>
            <p className="text-xs opacity-80">pact color preview</p>
          </div>
          <div className="rounded-sm border border-border bg-background p-3">
            <p className="text-sm text-foreground">Contrast: <span className="font-mono font-semibold">{contrast}:1</span> {pass ? '✓ Pass' : '✗ Fail'} <span className="text-xs text-muted-foreground">(AA 4.5)</span></p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConvertTool() {
  const [kind, setKind] = useState<'length' | 'temp' | 'weight'>('length');
  const [value, setValue] = useState('10');
  const n = parseFloat(value) || 0;
  const out = (() => {
    if (kind === 'length') return { a: `${n} km`, b: `${(n * 0.621371).toFixed(3)} mi`, rev: `${n} mi → ${(n * 1.60934).toFixed(3)} km` };
    if (kind === 'temp') return { a: `${n} °C`, b: `${(n * 9/5 + 32).toFixed(2)} °F`, rev: `${n} °F → ${((n - 32) * 5/9).toFixed(2)} °C` };
    return { a: `${n} kg`, b: `${(n * 2.20462).toFixed(3)} lb`, rev: `${n} lb → ${(n * 0.453592).toFixed(3)} kg` };
  })();
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">x → y converters</h3>
      <div className="flex gap-1.5">
        {(['length','temp','weight'] as const).map((k) => (
          <Button key={k} variant={kind===k?'primary':'ghost'} size="sm" className="capitalize rounded-sm" onClick={() => setKind(k)}>{k}</Button>
        ))}
      </div>
      <input value={value} onChange={(e) => setValue(e.target.value)} type="number" className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring" placeholder="Enter value" />
      <div className="grid gap-2 md:grid-cols-2">
        <div className="rounded-sm border border-border bg-muted p-3">
          <p className="text-xs text-muted-foreground">{out.a} →</p>
          <p className="font-mono text-lg font-semibold text-foreground">{out.b}</p>
        </div>
        <div className="rounded-sm border border-border bg-background p-3">
          <p className="text-xs text-muted-foreground">Reverse</p>
          <p className="font-mono text-sm text-foreground">{out.rev}</p>
        </div>
      </div>
    </div>
  );
}

function QrTool() {
  const [text, setText] = useState('https://pact.app/@you');
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">QR maker (mock)</h3>
      <input value={text} onChange={(e) => setText(e.target.value)} className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-ring" />
      <div className="flex gap-4">
        <div className="flex h-32 w-32 items-center justify-center rounded-sm border border-border bg-white p-2">
          <div className="grid h-full w-full grid-cols-5 gap-0.5">
            {Array.from({ length: 25 }).map((_, i) => (
              <div key={i} className={`rounded-sm ${Math.random() > 0.4 ? 'bg-black' : 'bg-white border border-zinc-200'}`} />
            ))}
          </div>
        </div>
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">Text encoded:</p>
          <p className="break-all font-mono text-xs text-foreground">{text}</p>
          <p className="mt-2 text-xs text-muted-foreground">Real QR generation would use a library locally — this is a mock preview.</p>
        </div>
      </div>
    </div>
  );
}

function ImageTool() {
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Image (compress ≤5mb)</h3>
      <div className="rounded-sm border border-dashed border-border bg-muted/30 p-6 text-center">
        <input type="file" accept="image/*" onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setFile({ name: f.name, size: f.size });
        }} className="text-sm" />
        <p className="mt-2 text-xs text-muted-foreground">Mock — checks 5mb limit locally, compress planned</p>
      </div>
      {file && (
        <div className={`rounded-sm border p-3 ${file.size > 5*1024*1024 ? 'border-destructive bg-destructive/10 text-destructive' : 'border-border bg-background text-foreground'}`}>
          <p className="text-sm font-medium">{file.name}</p>
          <p className="text-xs">{(file.size/1024/1024).toFixed(2)} MB {file.size > 5*1024*1024 ? '— exceeds 5mb ❌' : '— ok ✓'}</p>
        </div>
      )}
    </div>
  );
}
