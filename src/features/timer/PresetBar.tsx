import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { PresetDialog } from '@/features/timer/PresetDialog';
import { PresetIcon } from '@/features/timer/PresetIcon';
import { MAX_PRESETS, type TimerPreset } from '@/features/timer/presets';
import { activePreset, useTimerStore } from '@/features/timer/store';
import { cn } from '@/lib/cn';

/** Your own timers as one-tap chips under the phase switch: pick one to set the focus length (and show its icon). */
export function PresetBar({ disabled }: { disabled: boolean }) {
  const presets = useTimerStore((s) => s.presets);
  const activeId = useTimerStore((s) => activePreset(s)?.id ?? null);
  const apply = useTimerStore((s) => s.applyPreset);
  const phase = useTimerStore((s) => s.phase);
  const [editing, setEditing] = useState<TimerPreset | 'new' | null>(null);

  return (
    <>
      <fieldset className="m-0 flex w-full max-w-md min-w-0 flex-wrap items-center justify-center gap-1.5 border-0 p-0">
        <legend className="sr-only">Your timers</legend>
        {presets.map((p) => {
          const active = activeId === p.id && phase === 'focus';
          return (
            <div key={p.id} className="group relative">
              <button
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => apply(p.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setEditing(p);
                }}
                title={disabled ? 'Pause or reset to switch timers' : `${p.name} · ${p.minutes} min`}
                className={cn(
                  'flex h-8 items-center gap-1.5 rounded-lg border pl-2.5 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                  active ? 'border-brand/40 bg-brand-soft pr-8 text-brand-text' : 'bg-card/60 pr-2.5 hover:bg-accent group-hover:pr-8 group-focus-within:pr-8',
                )}
              >
                <PresetIcon icon={p.icon} className="size-3.5" />
                <span className="max-w-[8rem] truncate font-medium">{p.name}</span>
                <span className="tabular text-xs text-muted-foreground">{p.minutes}m</span>
              </button>
              <button
                type="button"
                aria-label={`Edit ${p.name}`}
                onClick={() => setEditing(p)}
                className={cn(
                  'absolute inset-y-1 right-1 grid w-6 place-items-center rounded-md text-muted-foreground transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100',
                  active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
                )}
              >
                <Pencil className="size-3" />
              </button>
            </div>
          );
        })}
        {presets.length < MAX_PRESETS && (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="flex h-8 items-center gap-1 rounded-lg border border-dashed px-2.5 text-[13px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-3.5" />
            {presets.length === 0 ? 'Add your own timer' : 'New'}
          </button>
        )}
      </fieldset>

      <PresetDialog
        key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id}
        preset={editing === 'new' || editing === null ? null : editing}
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
      />
    </>
  );
}
