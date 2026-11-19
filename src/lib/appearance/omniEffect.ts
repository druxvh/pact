/**
 * Search bar effects: an optional light show around the Home search box (and, much quieter, along the underside of the
 * ⌘K palette's field). Pure data here — `components/omnibox/OmniFx.tsx` mounts them and `features/home/effects/*` draws them (canvas, one shared animation loop).
 *
 * Which colours an effect uses is part of its character: Beam and Neon follow the accent, the rest keep their own.
 */

export const OMNI_EFFECT_IDS = ['none', 'beam', 'fire', 'electric', 'haze', 'neon', 'aurora', 'stardust', 'matrix', 'lava'] as const;
export type OmniEffectId = (typeof OMNI_EFFECT_IDS)[number];

export const DEFAULT_OMNI_EFFECT: OmniEffectId = 'none';

export const isOmniEffectId = (v: unknown): v is OmniEffectId => (OMNI_EFFECT_IDS as readonly unknown[]).includes(v);

/** Anything from storage or a file → a valid effect; unknown or missing values (an older install) mean no effect. */
export const coerceOmniEffect = (v: unknown): OmniEffectId => (isOmniEffectId(v) ? v : DEFAULT_OMNI_EFFECT);

export type OmniEffectDef = {
  id: OmniEffectId;
  label: string;
  description: string;
  /** Takes its colour from the accent (so the picker can say so). */
  followsAccent: boolean;
};

export const OMNI_EFFECTS: readonly OmniEffectDef[] = [
  { id: 'none', label: 'None', description: 'A plain search box.', followsAccent: false },
  { id: 'beam', label: 'Beam', description: 'A comet with a fading tail lapping the border, in your accent colour.', followsAccent: true },
  { id: 'fire', label: 'Fire', description: 'Real flames with drifting embers and a flickering glow.', followsAccent: false },
  { id: 'electric', label: 'Electric', description: 'Branching lightning that crackles along the border and strikes as you type.', followsAccent: false },
  { id: 'haze', label: 'Haze', description: 'A drifting pink mist with a touch of film grain.', followsAccent: false },
  { id: 'neon', label: 'Neon', description: 'A glass neon tube in your accent colour: it hums, flickers and now and then stutters.', followsAccent: true },
  { id: 'aurora', label: 'Aurora', description: 'Rippling green, teal and violet curtains above the box, with a few stars.', followsAccent: false },
  { id: 'stardust', label: 'Stardust', description: 'A tiny galaxy: twinkling stars, a drifting dust lane and the odd shooting star.', followsAccent: false },
  { id: 'matrix', label: 'Matrix', description: 'Digital rain falling past the box, in green with a hint of your accent.', followsAccent: false },
  { id: 'lava', label: 'Lava', description: 'Slow molten magma crawling along the border, with crust, cracks and popping bubbles.', followsAccent: false },
];

export const omniEffectById = (id: OmniEffectId): OmniEffectDef => OMNI_EFFECTS.find((e) => e.id === id) ?? (OMNI_EFFECTS[0] as OmniEffectDef);
