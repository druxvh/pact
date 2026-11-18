import { type CSSProperties, useState } from 'react';
import { cn } from '@/lib/cn';
import { initialsOf, sourceHue } from './logic';

const SIZES = { xs: 'size-5 text-[9px]', sm: 'size-6 text-[10px]', md: 'size-8 text-xs', lg: 'size-10 text-sm' } as const;

/** A publication's mark: its initials on a quiet tint of a colour that is always the same for that source. No network, no logos to license. */
export function SourceTile({ source, size = 'sm', className }: { source: { id: string; name: string }; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ '--h': sourceHue(source.id) } as CSSProperties}
      className={cn(
        'inline-grid shrink-0 select-none place-items-center rounded-md font-semibold tracking-tight',
        'bg-[oklch(0.93_0.05_var(--h))] text-[oklch(0.4_0.11_var(--h))] dark:bg-[oklch(0.32_0.07_var(--h))] dark:text-[oklch(0.88_0.08_var(--h))]',
        SIZES[size],
        className,
      )}
    >
      {initialsOf(source.name)}
    </span>
  );
}

/** What stands in for a missing picture: a soft gradient in the source's colour with its initials, so a card never looks broken. */
export function CoverPlaceholder({ source, className }: { source: { id: string; name: string }; className?: string }) {
  const h = sourceHue(source.id);
  return (
    <div
      aria-hidden="true"
      className={cn('relative grid size-full select-none place-items-center overflow-hidden', className)}
      style={{ background: `linear-gradient(135deg, oklch(0.62 0.12 ${h} / 0.32), oklch(0.5 0.1 ${(h + 50) % 360} / 0.2))` }}
    >
      <span className="text-4xl font-semibold tracking-tight opacity-40" style={{ color: `oklch(0.55 0.12 ${h})` }}>
        {initialsOf(source.name)}
      </span>
    </div>
  );
}

/** A story's picture, loaded lazily and without a Referer; falls back to the placeholder if it can't be loaded. */
export function Cover({
  src,
  source,
  className,
  imgClassName,
  priority,
}: {
  src: string | null;
  source: { id: string; name: string };
  className?: string;
  imgClassName?: string;
  priority?: boolean;
}) {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading');
  return (
    <div className={cn('relative overflow-hidden bg-muted', className)}>
      {(!src || state === 'failed') && <CoverPlaceholder source={source} className="absolute inset-0" />}
      {src && state !== 'failed' && (
        <img
          src={src}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onLoad={() => setState('ok')}
          onError={() => setState('failed')}
          className={cn(
            'size-full object-cover transition-[opacity,transform] duration-500 ease-out-expo',
            state === 'ok' ? 'opacity-100' : 'opacity-0',
            imgClassName,
          )}
        />
      )}
    </div>
  );
}
