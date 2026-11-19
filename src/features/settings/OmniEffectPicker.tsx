import { Check, Search } from 'lucide-react';
import { OmniFx } from '@/components/omnibox/OmniFx';
import { OMNI_EFFECTS, type OmniEffectId, omniEffectById } from '@/lib/appearance/omniEffect';
import { cn } from '@/lib/cn';
import { useAppearanceStore } from '@/store/useAppearanceStore';

/**
 * A little search pill with the effect actually running around it (the same engine as the real box, at half size, on the one shared
 * animation loop), so every option is shown moving — in your accent colour, your roundness, your light or dark theme.
 */
export function OmniEffectPreview({ effect, className }: { effect: OmniEffectId; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('grid h-[92px] place-items-center overflow-hidden rounded-md border bg-background px-6', className)}>
      <OmniFx effect={effect} scale={0.5} className="w-full">
        <div className="relative flex h-7 items-center gap-1.5 rounded-lg border bg-card/80 px-2 shadow-xs backdrop-blur-md">
          <Search className="size-3 shrink-0 text-muted-foreground" />
          <span className="h-[3px] w-9 rounded-full bg-muted-foreground/40" />
          <span className="ml-auto size-4 rounded-md bg-brand" />
        </div>
      </OmniFx>
    </div>
  );
}

/**
 * Settings → Appearance → Search bar effect: a light show around the Home search box, picked from live thumbnails.
 * (⌘K shows the same effect as one quiet line under its field.)
 */
export function OmniEffectRow() {
  const effect = useAppearanceStore((s) => s.omniEffect);
  const setEffect = useAppearanceStore((s) => s.setOmniEffect);
  const current = omniEffectById(effect);

  return (
    <div className="py-3">
      <div className="mb-2.5 min-w-0">
        <p className="text-[13px] font-medium leading-5">Search bar effect</p>
        <p className="text-xs leading-snug text-muted-foreground">
          {current.description} Shown around the Home search box{current.followsAccent ? ' in your accent colour' : ''}; it moves with you as you type, and
          stands still when animations are reduced.
        </p>
      </div>
      <fieldset className="m-0 grid min-w-0 grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 border-0 p-0">
        <legend className="sr-only">Search bar effect</legend>
        {OMNI_EFFECTS.map((e) => {
          const selected = effect === e.id;
          return (
            <button
              key={e.id}
              type="button"
              aria-pressed={selected}
              title={e.description}
              onClick={() => setEffect(e.id)}
              className={cn(
                'flex min-w-0 flex-col gap-1.5 rounded-lg border p-1.5 text-left outline-offset-2 transition-[border-color,background-color,transform] duration-150 active:scale-[0.98]',
                selected ? 'border-brand/60 bg-brand-soft' : 'hover:border-foreground/25 hover:bg-accent/50',
              )}
            >
              <OmniEffectPreview effect={e.id} />
              <span className="flex items-center justify-between px-0.5 text-[13px] font-medium">
                {e.label}
                {selected && <Check className="size-3.5 text-brand-text" aria-hidden="true" />}
              </span>
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}
