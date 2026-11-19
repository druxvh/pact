import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

const SIZES = { md: 'size-10 text-sm', lg: 'size-12 text-base' } as const;

/** A community's avatar: its initials on its own colour. Corner radius follows the app's one-rule (≤ rounded-lg). */
export function CommunityIcon({ name, hue, size = 'md', className }: { name: string; hue: number; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-lg font-semibold text-white', SIZES[size], className)}
      style={{ background: `linear-gradient(135deg, oklch(0.62 0.16 ${hue}), oklch(0.46 0.15 ${(hue + 40) % 360}))` }}
    >
      {initials(name)}
    </span>
  );
}
