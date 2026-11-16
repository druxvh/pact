import { Check } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Input } from '@/components/ui';
import { ACCENT_PRESETS, type AccentChoice, DEFAULT_ACCENT_ID, isValidHex, swatchHex } from '@/lib/appearance/accent';
import { cn } from '@/lib/cn';
import { luminanceOf, parseHex, rgbToOklch } from '@/lib/oklch';
import { useAppearanceStore } from '@/store/useAppearanceStore';

function Swatch({ hex, label, selected, onClick }: { hex: string; label: string; selected: boolean; onClick: () => void }) {
  const rgb = parseHex(hex);
  const light = rgb ? luminanceOf(rgbToOklch(rgb)) > 0.35 : false; // dark tick on pale swatches, white on deep ones
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      className={cn(
        'relative grid size-8 place-items-center rounded-md outline-offset-2 transition-[transform,box-shadow] duration-150 hover:scale-110 active:scale-95',
        selected ? 'ring-2 ring-foreground ring-offset-2 ring-offset-card' : 'ring-1 ring-black/10 dark:ring-white/15',
      )}
      style={{ background: hex }}
    >
      {selected && <Check className={cn('size-4', light ? 'text-black/75' : 'text-white')} />}
    </button>
  );
}

/** Pick the accent that drives buttons, highlights, focus rings and brand-coloured text everywhere. */
export function AccentPicker() {
  const accent = useAppearanceStore((s) => s.accent);
  const setAccent = useAppearanceStore((s) => s.setAccent);
  const isCustom = accent.kind === 'custom';
  const customHex = accent.kind === 'custom' ? accent.hex : '#6366f1';
  const [draft, setDraft] = useState(customHex);
  const draftValid = isValidHex(draft);

  const choose = (next: AccentChoice) => setAccent(next);

  return (
    <div className="space-y-4">
      <fieldset className="flex min-w-0 flex-wrap gap-2.5">
        <legend className="sr-only">Accent colour</legend>
        {ACCENT_PRESETS.map((p) => {
          const choice: AccentChoice = { kind: 'preset', id: p.id };
          return (
            <Swatch
              key={p.id}
              hex={swatchHex(choice)}
              label={p.label}
              selected={accent.kind === 'preset' && accent.id === p.id}
              onClick={() => choose(choice)}
            />
          );
        })}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <label
          className={cn(
            'relative grid size-8 cursor-pointer place-items-center overflow-hidden rounded-md ring-1 ring-black/10 dark:ring-white/15',
            isCustom && 'ring-2 ring-foreground ring-offset-2 ring-offset-card',
          )}
        >
          <span className="absolute inset-0" style={{ background: draftValid ? draft : '#888', backgroundImage: draftValid ? undefined : undefined }} />
          <span className="sr-only">Custom colour</span>
          <input
            type="color"
            value={draftValid && draft.length === 7 ? draft : '#6366f1'}
            onChange={(e) => {
              setDraft(e.target.value);
              choose({ kind: 'custom', hex: e.target.value });
            }}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <Input
          aria-label="Custom accent hex colour"
          value={draft}
          onChange={(e) => {
            const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            setDraft(v);
            if (isValidHex(v)) choose({ kind: 'custom', hex: v });
          }}
          maxLength={7}
          spellCheck={false}
          aria-invalid={draft.length > 1 && !draftValid ? true : undefined}
          className="w-28 font-mono text-[13px]"
          placeholder="#6366f1"
        />
        <span className="text-xs text-muted-foreground">Any colour — contrast is adjusted automatically so text stays readable.</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-background/40 p-3" aria-hidden="true">
        <Button variant="primary" size="sm" tabIndex={-1}>
          Primary
        </Button>
        <Button variant="soft" size="sm" tabIndex={-1}>
          Soft
        </Button>
        <Badge tone="brand">Badge</Badge>
        <span className="text-[13px] font-medium text-brand-text">Link text</span>
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
          <span className="block h-full w-2/3 rounded-full bg-brand" />
        </span>
        {(accent.kind !== 'preset' || accent.id !== DEFAULT_ACCENT_ID) && (
          <Button variant="ghost" size="xs" className="ml-auto" onClick={() => choose({ kind: 'preset', id: DEFAULT_ACCENT_ID })}>
            Reset to orange
          </Button>
        )}
      </div>
    </div>
  );
}
