import type { Transition, Variants } from 'motion/react';

/** Shared easing curves (mirror the CSS `--ease-*` tokens). */
export const ease = {
  outExpo: [0.16, 1, 0.3, 1],
  outQuart: [0.25, 1, 0.5, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const;

/** Spring presets — tuned so UI feels responsive but never jittery. */
export const spring = {
  /** buttons, toggles, small things */
  snappy: { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 },
  /** panels, cards */
  soft: { type: 'spring', stiffness: 280, damping: 30 },
  /** playful overshoot — badges, emoji, success states */
  bouncy: { type: 'spring', stiffness: 420, damping: 17 },
  /** layout / shared-element moves */
  layout: { type: 'spring', stiffness: 380, damping: 36 },
} satisfies Record<string, Transition>;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: ease.outExpo } },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.25 } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  show: { opacity: 1, scale: 1, transition: spring.soft },
};

/** Parent variant that staggers `fadeUp`-style children. */
export const stagger = (gap = 0.045, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: gap, delayChildren: delay } },
});

/**
 * Page-level transition used by the app shell when switching sections.
 * Opacity + a few pixels of travel only: animating `filter: blur()` over a whole page forces the browser to
 * re-rasterise it every frame, which made heavier pages (Home, Focus, Settings) take well over a second to appear.
 */
export const page = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: ease.outExpo } },
  exit: { opacity: 0, transition: { duration: 0.08, ease: ease.outQuart } },
};

/** Props for a gently-pressable surface (cards, tiles). */
export const pressable = {
  whileHover: { y: -2 },
  whileTap: { scale: 0.985 },
  transition: spring.snappy,
} as const;
