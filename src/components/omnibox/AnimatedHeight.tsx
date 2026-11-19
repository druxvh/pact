import { animate, motion, useMotionValue } from 'motion/react';
import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { useMotionOff } from '@/components/omnibox/useMotionOff';

/**
 * Animates its height to follow its content, so the list grows and shrinks smoothly as results change instead of
 * jumping. The height is a motion value (no React re-render per frame); children are measured with a
 * ResizeObserver. Honours the app's reduced-motion setting by snapping.
 */
export function AnimatedHeight({ children, className }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const height = useMotionValue<number>(0);
  const first = useRef(true);
  const off = useMotionOff();
  const offRef = useRef(off);
  offRef.current = off;

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    let controls: ReturnType<typeof animate> | undefined;
    const sync = () => {
      const h = el.getBoundingClientRect().height;
      controls?.stop();
      // A hidden tab never paints frames, so an animation would stall mid-way: snap instead.
      if (first.current || offRef.current || document.visibilityState === 'hidden') height.set(h);
      else controls = animate(height, h, { type: 'spring', stiffness: 520, damping: 44, mass: 0.8 });
      first.current = false;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      ro.disconnect();
      controls?.stop();
    };
  }, [height]);

  return (
    <motion.div style={{ height }} className={className}>
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}
