import { Check } from 'lucide-react';
import { type HomeLayout, PRESETS, type PresetId, presetOf, useHomeLayoutStore } from '@/features/home/layout';
import { cn } from '@/lib/cn';
import { ScrollX } from './ui';

/** How many columns the widgets sit in on Home (mirrors `HomeWidgets`: one or two centred, four make a 2×2, the rest fill three). */
export function widgetColumns(count: number): 1 | 2 | 3 {
  if (count <= 1) return 1;
  if (count === 2 || count === 4) return 2;
  return 3;
}

const COLUMNS = { 1: 'grid-cols-1 w-6', 2: 'grid-cols-2 w-12', 3: 'grid-cols-3 w-[4.5rem]' } as const;
const SHORTCUT_SLOTS = ['a', 'b', 'c', 'd', 'e'] as const;
/** Home shows at most this many widgets in a preview — enough to read the shape, small enough to stay a thumbnail. */
const MAX_PREVIEW_WIDGETS = 6;

/**
 * A tiny picture of a Home layout — drawn from the layout itself (not a screenshot), so a preview can never disagree with what you
 * get, follows your accent colour, and any layout added later gets one for free.
 */
export function LayoutPreview({ layout, className }: { layout: HomeLayout; className?: string }) {
  const { clockStyle, showDate, showSearch, showShortcuts, widgets } = layout;
  const shown = widgets.slice(0, MAX_PREVIEW_WIDGETS);
  return (
    <div
      aria-hidden="true"
      className={cn('flex h-20 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-md border bg-background px-2', className)}
    >
      {clockStyle === 'digital' && (
        <div className="flex items-center gap-[3px]">
          <span className="h-3 w-4 rounded-sm bg-foreground/75" />
          <span className="size-[3px] rounded-full bg-brand" />
          <span className="h-3 w-4 rounded-sm bg-foreground/75" />
        </div>
      )}
      {clockStyle === 'compact' && <div className="h-1.5 w-7 rounded-sm bg-foreground/75" />}
      {clockStyle === 'analog' && (
        <div className="relative size-7 rounded-full border-2 border-foreground/60">
          <span className="absolute left-1/2 top-[3px] h-2 w-px -translate-x-1/2 bg-foreground/70" />
          <span className="absolute left-1/2 top-1/2 h-px w-2 bg-brand" />
        </div>
      )}
      {showDate && clockStyle !== 'none' && <div className="h-[3px] w-9 rounded-full bg-muted-foreground/40" />}
      {showSearch && (
        <div className="flex h-2.5 w-[72%] items-center gap-1 rounded-md border bg-card px-1">
          <span className="size-1 rounded-full bg-muted-foreground/50" />
          <span className="h-[2px] w-5 rounded-full bg-muted-foreground/30" />
        </div>
      )}
      {showShortcuts && (
        <div className="flex gap-1">
          {SHORTCUT_SLOTS.map((slot) => (
            <span key={slot} className="size-2 rounded-sm bg-muted-foreground/35" />
          ))}
        </div>
      )}
      {shown.length > 0 && (
        <div className={cn('grid gap-[3px]', COLUMNS[widgetColumns(shown.length)])}>
          {shown.map((w) => (
            <span key={w} className="h-3 rounded-sm border border-brand/40 bg-brand-soft" />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Settings → Home → Layout: one-click looks, shown as pictures so you can see what you are choosing. The strip scrolls sideways,
 * so adding more layouts later needs nothing here. Tweaking anything afterwards makes it “Custom” (nothing selected).
 */
export function LayoutRow() {
  const layout = useHomeLayoutStore((s) => s.layout);
  const applyPreset = useHomeLayoutStore((s) => s.applyPreset);
  const current = presetOf(layout);
  const preset = PRESETS.find((p) => p.id === current);

  return (
    <div className="py-3">
      <div className="mb-2.5 min-w-0">
        <p className="text-[13px] font-medium leading-5">Layout</p>
        <p className="text-xs leading-snug text-muted-foreground">{preset ? preset.description : 'Customised — pick a layout to start over.'}</p>
      </div>
      <ScrollX>
        <fieldset className="m-0 flex min-w-0 gap-2 border-0 p-0">
          <legend className="sr-only">Home layout</legend>
          {PRESETS.map((p) => {
            const selected = current === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={selected}
                title={p.description}
                onClick={() => applyPreset(p.id as PresetId)}
                className={cn(
                  'flex w-32 shrink-0 flex-col gap-1.5 rounded-lg border p-1.5 text-left outline-offset-2 transition-[border-color,background-color,transform] duration-150 active:scale-[0.98]',
                  selected ? 'border-brand/60 bg-brand-soft' : 'hover:border-foreground/25 hover:bg-accent/50',
                )}
              >
                <LayoutPreview layout={p.layout} />
                <span className="flex items-center justify-between px-0.5 text-[13px] font-medium">
                  {p.label}
                  {selected && <Check className="size-3.5 text-brand-text" aria-hidden="true" />}
                </span>
              </button>
            );
          })}
        </fieldset>
      </ScrollX>
    </div>
  );
}
