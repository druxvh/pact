import { Check } from 'lucide-react';
import { type HomeLayout, PRESETS, type PresetId, presetOf, useHomeLayoutStore } from '@/features/home/layout';
import { cn } from '@/lib/cn';

/** A tiny wireframe of a layout — drawn from the layout itself, so a preview can never disagree with what you get. */
export function LayoutPreview({ layout }: { layout: HomeLayout }) {
  const { clockStyle, showSearch, showShortcuts, widgets } = layout;
  return (
    <div aria-hidden="true" className="flex h-24 flex-col items-center justify-center gap-2 rounded-md border bg-background/60 px-3">
      {clockStyle === 'digital' && <div className="h-3.5 w-14 rounded-sm bg-foreground/70" />}
      {clockStyle === 'compact' && <div className="h-2 w-8 rounded-sm bg-foreground/70" />}
      {clockStyle === 'analog' && (
        <div className="relative size-7 rounded-full border-2 border-foreground/60">
          <span className="absolute left-1/2 top-1 h-2 w-px -translate-x-1/2 bg-foreground/70" />
          <span className="absolute left-1/2 top-1/2 h-px w-2 bg-brand" />
        </div>
      )}
      {clockStyle === 'none' && <div className="h-1 w-10 rounded-sm bg-muted-foreground/40" />}
      {showSearch && <div className="h-2 w-20 rounded-md border bg-card" />}
      {showShortcuts && (
        <div className="flex gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="size-2.5 rounded-sm bg-muted-foreground/35" />
          ))}
        </div>
      )}
      {widgets.length > 0 && (
        <div className="flex gap-1">
          {widgets.slice(0, 4).map((w) => (
            <span key={w} className="h-4 w-6 rounded-sm border border-brand/40 bg-brand-soft" />
          ))}
        </div>
      )}
    </div>
  );
}

/** Home layouts as one-click themes. Tweaking anything afterwards makes it “Custom”. */
export function HomePresetPicker() {
  const layout = useHomeLayoutStore((s) => s.layout);
  const applyPreset = useHomeLayoutStore((s) => s.applyPreset);
  const current = presetOf(layout);

  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Home layout</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {PRESETS.map((p) => {
          const selected = current === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={selected}
              onClick={() => applyPreset(p.id as PresetId)}
              className={cn(
                'group relative flex flex-col gap-2 rounded-lg border p-2 text-left outline-offset-2 transition-[border-color,background-color,transform] duration-150 active:scale-[0.98]',
                selected ? 'border-brand/60 bg-brand-soft' : 'hover:border-foreground/25 hover:bg-accent/50',
              )}
            >
              <LayoutPreview layout={p.layout} />
              <span className="px-0.5">
                <span className="flex items-center justify-between text-[13px] font-medium">
                  {p.label}
                  {selected && <Check className="size-3.5 text-brand-text" />}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{p.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      {current === 'custom' && <p className="mt-2.5 text-xs text-muted-foreground">You’ve customised this layout. Pick a theme above to start over.</p>}
    </fieldset>
  );
}
