import { useMotionOff } from '@/features/camera/useMotionOff';
import { cn } from '@/lib/cn';
import './equalizer.css';

/**
 * Three bars that bounce while music plays. Decorative (aria-hidden): whatever shows them says "listening" in words too.
 * Still — at rest, not moving — when the person turned animations off (Settings → Animations, or the OS setting), and when `playing`
 * is false (then also dimmed).
 */
export function Equalizer({ playing = true, size = 'sm', className }: { playing?: boolean; size?: 'xs' | 'sm' | 'md'; className?: string }) {
  const motionOff = useMotionOff();
  return (
    <span
      aria-hidden="true"
      data-size={size}
      data-state={playing && !motionOff ? 'live' : 'still'}
      data-dim={playing ? undefined : ''}
      className={cn('np-eq', className)}
    >
      <i />
      <i />
      <i />
    </span>
  );
}
