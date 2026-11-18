import { MotionConfigContext, useReducedMotion } from 'motion/react';
import { useContext } from 'react';

/** The app's animation preference (Settings → Animations lives on the shell's MotionConfig), falling back to the OS. */
export function useMotionOff(): boolean {
  const configured = useContext(MotionConfigContext).reducedMotion;
  const os = useReducedMotion();
  return configured === 'always' || (configured !== 'never' && Boolean(os));
}
