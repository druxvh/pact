import { Check, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Input, Popover, PopoverTrigger } from '@/components/ui';
import { ACCENT_PRESETS, type AccentChoice, DEFAULT_ACCENT_ID, isValidHex, presetById, swatchHex } from '@/lib/appearance/accent';
import { cn } from '@/lib/cn';
import { luminanceOf, parseHex, rgbToOklch } from '@/lib/oklch';
import { useAppearanceStore } from '@/store/useAppearanceStore';
import { Panel, SettingsRow } from './ui';

/** The swatches shown right in the row — a spread of hues; everything else lives behind "More". */
export const INLINE_ACCENTS = ['orange', 'red', 'pink', 'violet', 'blue', 'teal', 'green', 'graphite'] as const;

const isCurrent = (accent: AccentChoice, choice: AccentChoice) => accent.kind === 'preset' && choice.kind === 'preset' && accent.id === choice.id;

function Swatch({ hex, label, selected, onClick, size = 'size-6' }: { hex: string; label: string; selected: boolean; onClick: () => void; size?: string }) {
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
        'relative grid place-items-center rounded-md outline-offset-2 transition-[transform,box-shadow] duration-150 hover:scale-110 active:scale-95',
        size,
        selected ? 'ring-2 ring-foreground ring-offset-2 ring-offset-card' : 'ring-1 ring-black/10 dark:ring-white/15',
      )}
      style={{ background: hex }}
    >
      {selected && <Check className={cn('size-3.5', light ? 'text-black/75' : 'text-white')} />}
    </button>
  );
}

const choiceHex = (choice: AccentChoice) => (choice.kind === 'custom' ? choice.hex : swatchHex(choice));
const choiceName = (choice: AccentChoice) => (choice.kind === 'custom' ? `Custom ${choice.hex.toLowerCase()}` : (presetById(choice.id)?.label ?? 'Orange'));

/** Everything that isn't one of the inline swatches: the other presets, any colour you like, and a sample of what it does. */
function MorePanel() {
  const accent = useAppearanceStore((s) => s.accent);
  const setAccent = useAppearanceStore((s) => s.setAccent);
  const isCustom = accent.kind === 'custom';
  const [draft, setDraft] = useState(accent.kind === 'custom' ? accent.hex : '#6366f1');
  const draftValid = isValidHex(draft);
  const rest = ACCENT_PRESETS.filter((p) => !(INLINE_ACCENTS as readonly string[]).includes(p.id));

  return (
    <Panel align="end" className="w-[min(19rem,calc(100vw-1.5rem))] space-y-3">
      <fieldset className="min-w-0">
        <legend className="mb-1.5 text-xs font-medium text-muted-foreground">More colours</legend>
        <div className="flex flex-wrap gap-2">
          {rest.map((p) => {
            const choice: AccentChoice = { kind: 'preset', id: p.id };
            return (
              <Swatch key={p.id} hex={swatchHex(choice)} label={p.label} selected={isCurrent(accent, choice)} onClick={() => setAccent(choice)} size="size-7" />
            );
          })}
        </div>
      </fieldset>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Any colour</p>
        <div className="flex items-center gap-2">
          <label
            className={cn(
              'relative grid size-7 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-md ring-1 ring-black/10 focus-within:ring-2 focus-within:ring-ring dark:ring-white/15',
              isCustom && 'ring-2 ring-foreground ring-offset-2 ring-offset-popover',
            )}
          >
            <span className="absolute inset-0" style={{ background: draftValid ? draft : '#888' }} />
            <span className="sr-only">Pick a custom colour</span>
            <input
              type="color"
              value={draftValid && draft.length === 7 ? draft : '#6366f1'}
              onChange={(e) => {
                setDraft(e.target.value);
                setAccent({ kind: 'custom', hex: e.target.value });
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
              if (isValidHex(v)) setAccent({ kind: 'custom', hex: v });
            }}
            maxLength={7}
            spellCheck={false}
            aria-invalid={draft.length > 1 && !draftValid ? true : undefined}
            className="h-7 w-24 font-mono text-[13px]"
            placeholder="#6366f1"
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">Contrast is adjusted so text stays readable.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <div aria-hidden="true" className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="xs" tabIndex={-1}>
            Primary
          </Button>
          <Button variant="soft" size="xs" tabIndex={-1}>
            Soft
          </Button>
          <Badge tone="brand">Badge</Badge>
          <span className="text-xs font-medium text-brand-text">Link</span>
        </div>
        {(accent.kind !== 'preset' || accent.id !== DEFAULT_ACCENT_ID) && (
          <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setAccent({ kind: 'preset', id: DEFAULT_ACCENT_ID })}>
            Reset to orange
          </Button>
        )}
      </div>
    </Panel>
  );
}

/** Settings → Appearance → Accent colour: eight swatches in the row, the rest (and any colour) in a popover. */
export function AccentRow() {
  const accent = useAppearanceStore((s) => s.accent);
  const setAccent = useAppearanceStore((s) => s.setAccent);
  const inline = INLINE_ACCENTS.map((id) => ACCENT_PRESETS.find((p) => p.id === id)).filter((p) => p !== undefined);
  const onRow = accent.kind === 'preset' && (INLINE_ACCENTS as readonly string[]).includes(accent.id);

  return (
    <SettingsRow label="Accent colour" description={`${choiceName(accent)} — buttons, highlights and focus rings.`}>
      <fieldset className="flex min-w-0 items-center gap-1.5 border-0 p-0">
        <legend className="sr-only">Accent colour</legend>
        {inline.map((p) => {
          const choice: AccentChoice = { kind: 'preset', id: p.id };
          return <Swatch key={p.id} hex={swatchHex(choice)} label={p.label} selected={isCurrent(accent, choice)} onClick={() => setAccent(choice)} />;
        })}
      </fieldset>
      <Popover>
        <PopoverTrigger render={<Button variant="outline" size="xs" aria-label="More accent colours" />}>
          {!onRow && (
            <span className="size-3 rounded-sm ring-1 ring-black/10 dark:ring-white/20" style={{ background: choiceHex(accent) }} aria-hidden="true" />
          )}
          More
          <ChevronDown />
        </PopoverTrigger>
        <MorePanel />
      </Popover>
    </SettingsRow>
  );
}
