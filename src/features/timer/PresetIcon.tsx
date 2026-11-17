import { cn } from '@/lib/cn';
import { resolveIcon } from './presets';

/** A custom timer's icon: one of the built-in glyphs, or any emoji the user picked. */
export function PresetIcon({ icon, className }: { icon: string; className?: string }) {
  const r = resolveIcon(icon);
  if (r.kind === 'emoji') {
    return (
      <span aria-hidden="true" className={cn('inline-grid place-items-center text-[1.05em] leading-none', className)}>
        {r.emoji}
      </span>
    );
  }
  return <r.Icon aria-hidden="true" className={cn('size-4', className)} />;
}
