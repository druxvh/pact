import { Equalizer } from '@/features/nowplaying/Equalizer';
import { cn } from '@/lib/cn';
import { hueFrom, initials } from '@/lib/format';

const SIZES = {
  xs: 'size-5 text-[9px]',
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
  xl: 'size-14 text-lg',
} as const;

/** Corner radius scales with the avatar but never exceeds rounded-lg. */
const RADIUS = { xs: 'rounded-sm', sm: 'rounded-md', md: 'rounded-lg', lg: 'rounded-lg', xl: 'rounded-lg' } as const;

/** The "listening now" badge sits on the top-right corner (the presence dot is bottom-right): a brand-coloured disc that grows with the avatar. */
const LISTENING = {
  xs: { disc: 'size-3 border', bars: 'xs' },
  sm: { disc: 'size-3.5 border', bars: 'xs' },
  md: { disc: 'size-4 border-2', bars: 'xs' },
  lg: { disc: 'size-[18px] border-2', bars: 'xs' },
  xl: { disc: 'size-5 border-2', bars: 'sm' },
} as const;

export type PresenceStatus = 'online' | 'away' | 'offline';

export type AvatarProps = {
  name: string;
  src?: string;
  size?: keyof typeof SIZES;
  status?: PresenceStatus;
  /** Music is playing in this person's browser right now (see features/nowplaying): adds a small equalizer badge. */
  listening?: boolean;
  className?: string;
};

/** Deterministic gradient avatar — same name, same colour, everywhere. */
export function Avatar({ name, src, size = 'md', status, listening, className }: AvatarProps) {
  const hue = hueFrom(name || '?');
  return (
    <span
      className={cn('relative inline-flex shrink-0 select-none items-center justify-center font-semibold text-white', RADIUS[size], SIZES[size], className)}
      style={{ background: `linear-gradient(135deg, oklch(0.6 0.15 ${hue}), oklch(0.46 0.16 ${(hue + 45) % 360}))` }}
      aria-hidden={status || listening ? undefined : true}
    >
      {src ? <img src={src} alt="" className="size-full rounded-[inherit] object-cover" /> : initials(name)}
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
      {listening && (
        <span
          role="img"
          aria-label="Listening to music"
          title="Listening now"
          className={cn('absolute -right-1 -top-1 grid place-items-center rounded-full border-card bg-brand text-brand-foreground', LISTENING[size].disc)}
        >
          <Equalizer size={LISTENING[size].bars} />
        </span>
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
        <span className={cn('inline-flex items-center justify-center bg-muted font-medium text-muted-foreground ring-2 ring-card', RADIUS[size], SIZES[size])}>
          +{extra}
        </span>
      )}
    </div>
  );
}
