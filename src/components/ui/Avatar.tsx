import { cn } from '@/lib/cn';
import { hueFrom, initials } from '@/lib/format';

const SIZES = {
  xs: 'size-5 text-[9px]',
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
  xl: 'size-14 text-lg',
} as const;

export type PresenceStatus = 'online' | 'away' | 'offline';

type Props = {
  name: string;
  src?: string;
  size?: keyof typeof SIZES;
  status?: PresenceStatus;
  className?: string;
};

/** Deterministic gradient avatar — same name, same colour, everywhere. */
export function Avatar({ name, src, size = 'md', status, className }: Props) {
  const hue = hueFrom(name || '?');
  return (
    <span
      className={cn('relative inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white', SIZES[size], className)}
      style={{ background: `linear-gradient(135deg, oklch(0.6 0.15 ${hue}), oklch(0.46 0.16 ${(hue + 45) % 360}))` }}
      aria-hidden={status ? undefined : true}
    >
      {src ? <img src={src} alt="" className="size-full rounded-full object-cover" /> : initials(name)}
      {status && (
        <span
          role="img"
          aria-label={status}
          className={cn(
            'absolute -bottom-px -right-px size-[32%] min-h-2 min-w-2 rounded-full border-2 border-card',
            status === 'online' && 'bg-success',
            status === 'away' && 'bg-warning',
            status === 'offline' && 'bg-subtle-foreground',
          )}
        />
      )}
    </span>
  );
}

export function AvatarGroup({ people, max = 4, size = 'sm' }: { people: Array<{ id: string; name: string }>; max?: number; size?: keyof typeof SIZES }) {
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <div className="flex items-center -space-x-1.5">
      {shown.map((p) => (
        <Avatar key={p.id} name={p.name} size={size} className="ring-2 ring-card" />
      ))}
      {extra > 0 && (
        <span className={cn('inline-flex items-center justify-center rounded-full bg-muted font-medium text-muted-foreground ring-2 ring-card', SIZES[size])}>
          +{extra}
        </span>
      )}
    </div>
  );
}
