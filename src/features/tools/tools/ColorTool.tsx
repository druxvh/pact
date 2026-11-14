import { ArrowLeftRight, Pipette, Wand2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Badge, Button, IconButton, Input } from '@/components/ui';
import { contrastRatio, parseColor, type RGB, suggestForeground, toHex, toHslString, toOklchString, toRgbString, wcag } from '@/features/tools/lib/color';
import { Field, ResultRow } from '@/features/tools/ui';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

function ColorInput({ label, value, onChange, valid }: { label: string; value: string; onChange: (v: string) => void; valid: boolean }) {
  const rgb = parseColor(value);
  const [dropperError, setDropperError] = useState(false);
  const Dropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <label
          className="relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-lg border shadow-xs"
          style={{ background: rgb ? toRgbString(rgb) : 'transparent' }}
        >
          <input
            type="color"
            aria-label={`${label} colour picker`}
            value={rgb ? toHex({ ...rgb, a: 1 }) : '#000000'}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          aria-label={`${label} colour value`}
          aria-invalid={!valid && value !== '' ? true : undefined}
          placeholder="#0a0a0a, rgb(…), hsl(…)"
          className="font-mono"
        />
        {Dropper && (
          <IconButton
            label={dropperError ? 'Eyedropper unavailable' : 'Pick a colour from the screen'}
            variant="outline"
            size="icon"
            onClick={async () => {
              try {
                const r = await new Dropper().open();
                onChange(r.sRGBHex);
              } catch {
                // user cancelled with Esc — not an error worth surfacing
                setDropperError(false);
              }
            }}
          >
            <Pipette />
          </IconButton>
        )}
      </div>
    </Field>
  );
}

function Check({ pass, label }: { pass: boolean; label: string }) {
  return (
    <motion.div
      layout
      transition={spring.snappy}
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[13px]',
        pass ? 'border-success/30 bg-success-soft' : 'border-destructive/30 bg-destructive-soft',
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <Badge tone={pass ? 'success' : 'destructive'}>{pass ? 'Pass' : 'Fail'}</Badge>
    </motion.div>
  );
}

export function ColorTool() {
  const [fgText, setFgText] = useState('#fb923c');
  const [bgText, setBgText] = useState('#0a0a0a');
  const fg = parseColor(fgText);
  const bg = parseColor(bgText);
  const ratio = fg && bg ? contrastRatio(fg, bg) : null;
  const level = ratio ? wcag(ratio) : null;

  const swap = () => {
    setFgText(bgText);
    setBgText(fgText);
  };
  const fix = () => {
    if (fg && bg) setFgText(toHex(suggestForeground(fg, bg, 4.5)));
  };

  const conversions = (c: RGB) =>
    [
      ['HEX', toHex(c)],
      ['RGB', toRgbString(c)],
      ['HSL', toHslString(c)],
      ['OKLCH', toOklchString(c)],
    ] as const;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <ColorInput label="Foreground" value={fgText} onChange={setFgText} valid={fg !== null} />
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={swap}>
            <ArrowLeftRight className="rotate-90" /> Swap
          </Button>
        </div>
        <ColorInput label="Background" value={bgText} onChange={setBgText} valid={bg !== null} />

        <div
          className="grid min-h-40 place-items-center rounded-2xl border p-6 text-center shadow-xs transition-colors duration-300"
          style={{ background: bg ? toRgbString(bg) : undefined, color: fg ? toRgbString(fg) : undefined }}
        >
          <div>
            <p className="text-3xl font-semibold tracking-tight">Aa — pact</p>
            <p className="mt-1 text-sm">The quick brown fox jumps over the lazy dog.</p>
            <p className="mt-3 text-xs opacity-80">Small text sample at 12px</p>
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <div className="rounded-2xl border bg-muted/30 p-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Contrast ratio</p>
              <motion.p
                key={ratio?.toFixed(2)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="tabular text-4xl font-semibold tracking-tight"
              >
                {ratio ? `${ratio.toFixed(2)}:1` : '—'}
              </motion.p>
            </div>
            {level && !level.aaNormal && (
              <Button variant="soft" size="sm" onClick={fix}>
                <Wand2 /> Fix foreground
              </Button>
            )}
          </div>
          {level && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Check pass={level.aaNormal} label="AA · normal text" />
              <Check pass={level.aaaNormal} label="AAA · normal text" />
              <Check pass={level.aaLarge} label="AA · large text" />
              <Check pass={level.aaaLarge} label="AAA · large text" />
            </div>
          )}
        </div>

        {fg && (
          <section aria-label="Foreground formats" className="space-y-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">Foreground formats</h3>
            {conversions(fg).map(([k, v]) => (
              <ResultRow key={k} label={k} value={v} />
            ))}
          </section>
        )}
        {bg && (
          <section aria-label="Background formats" className="space-y-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">Background formats</h3>
            {conversions(bg).map(([k, v]) => (
              <ResultRow key={k} label={k} value={v} />
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

export default ColorTool;
