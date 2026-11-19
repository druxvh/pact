import { type ReactNode, useEffect, useRef } from 'react';
import { useMotionOff } from '@/components/omnibox/useMotionOff';
import { LINE_HEIGHT, mountEffect } from '@/features/home/effects/engine';
import type { EffectName } from '@/features/home/effects/types';
import type { AccentChoice } from '@/lib/appearance/accent';
import type { OmniEffectId } from '@/lib/appearance/omniEffect';
import { cn } from '@/lib/cn';
import { useAppearanceStore } from '@/store/useAppearanceStore';
import { useThemeStore } from '@/store/useThemeStore';

/**
 * A primitive key for "what colour is the accent, in which style". The effect restarts when it changes (so it re-reads the colour) — and ONLY then:
 * the accent *object* is replaced whenever the store rehydrates (another tab saved appearance), and a restart is a visible jump, so never key on identity.
 */
export const looksKey = (accent: AccentChoice, style: string): string => `${accent.kind === 'preset' ? accent.id : accent.hex}|${style}`;

/**
 * The search bar effects (Settings → Appearance → Search bar effect), drawn on a canvas around whatever box this wraps.
 *
 * The wrapper is exactly as big as the box; the canvas covers the box and a margin around it, is click-through and aria-hidden, and has
 * the inside of the box erased on every frame — so the box behaves, and reads, exactly as without. The drawing lives in
 * `features/home/effects/*` (one shared animation loop for all of them; it pauses while the tab is hidden or the box is off screen).
 * Typing and Enter are heard through the wrapper (events bubble through it), so the host needs nothing more than to be wrapped.
 *
 * Motion: Settings → Animations (or the OS) set to reduced → the effect draws one still frame. Colours: Beam and Neon follow the
 * accent, the rest keep their own. Corners follow the roundness setting (the canvas reads the real `--radius-lg`).
 */
export function OmniFx({ effect, scale = 1, className, children }: { effect: OmniEffectId; scale?: number; className?: string; children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = useMotionOff();
  const dark = useThemeStore((s) => s.resolved) === 'dark';
  // anything that changes the look of the box (corner radius, accent colour, style) restarts the effect so it re-measures
  const radius = useAppearanceStore((s) => s.radius);
  const look = useAppearanceStore((s) => looksKey(s.accent, s.style));

  // biome-ignore lint/correctness/useExhaustiveDependencies: radius, accent and style are not read here — they change what the engine measures, so they restart it
  useEffect(() => {
    const h = host.current;
    const c = canvas.current;
    if (!h || !c || effect === 'none') return;
    const mounted = mountEffect(h, c, { name: effect as EffectName, scale, dark, still, mode: 'box' });
    return mounted.destroy;
  }, [effect, scale, dark, still, radius, look]);

  return (
    <div ref={host} className={cn('omni-fx', className)} data-fx={effect} data-still={still ? '' : undefined}>
      {children}
      {effect !== 'none' && <canvas ref={canvas} className="fx-canvas" aria-hidden="true" tabIndex={-1} />}
    </div>
  );
}

/** The strip under the ⌘K field is small: the field's text sits above it, so effects there stay within ~17px of the line. */
const LINE_SCALE = 0.5;

/**
 * The ⌘K palette's version: the same effect, but a thin strip along the underside of the field (flames or bolts rise from the line, a comet
 * runs along it), so the palette never gets a halo that could cover or clip the results below. Put it as the last child of a `relative` row;
 * it listens for typing on that row.
 */
export function OmniFxLine({ effect }: { effect: OmniEffectId }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const still = useMotionOff();
  const dark = useThemeStore((s) => s.resolved) === 'dark';
  const look = useAppearanceStore((s) => looksKey(s.accent, s.style));

  // biome-ignore lint/correctness/useExhaustiveDependencies: the accent / style key changes the colours the engine reads
  useEffect(() => {
    const h = host.current;
    const c = canvas.current;
    if (!h || !c || effect === 'none') return;
    return mountEffect(h, c, { name: effect as EffectName, scale: LINE_SCALE, dark, still, mode: 'line' }).destroy;
  }, [effect, dark, still, look]);

  if (effect === 'none') return null;
  return (
    <div ref={host} className="omni-fx-line" data-fx={effect} aria-hidden="true" style={{ height: LINE_HEIGHT * LINE_SCALE }}>
      <canvas ref={canvas} aria-hidden="true" tabIndex={-1} />
    </div>
  );
}
