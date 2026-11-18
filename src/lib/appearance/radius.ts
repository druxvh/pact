/**
 * Corner roundness: one preference that re-shapes every `rounded-sm | md | lg` in the app.
 *
 * Tailwind's radius utilities resolve through the theme variables `--radius-xs … --radius-lg` (see globals.css, where `md`
 * is the stock look). Picking another step overrides those variables, so buttons, cards, inputs, popovers, avatars and
 * the prose in notes all follow — and `rounded-full` (dots, switches, badges) deliberately doesn't.
 *
 * The scale keeps inner < outer at every step: a card is `lg`, the buttons and inputs inside it are `md`, the chips inside
 * those are `sm`. House rule from globals.css: nothing is rounder than `lg` (`xl … 3xl` are aliases for it).
 */

export const RADIUS_IDS = ['none', 'sm', 'md', 'lg'] as const;
export type RadiusId = (typeof RADIUS_IDS)[number];

export const DEFAULT_RADIUS: RadiusId = 'md';

export const isRadiusId = (v: unknown): v is RadiusId => (RADIUS_IDS as readonly unknown[]).includes(v);

type Steps = { xs: number; sm: number; md: number; lg: number };

/** Anything from storage or a file → a valid roundness; unknown or missing values mean the stock one. */
export const coerceRadius = (v: unknown): RadiusId => (isRadiusId(v) ? v : DEFAULT_RADIUS);

/** Pixel radii per preference. `md` mirrors the stock `--radius: 0.625rem` scale exactly (4 / 6 / 8 / 10). */
export const RADIUS_SCALE: Readonly<Record<RadiusId, Steps>> = {
  none: { xs: 0, sm: 0, md: 0, lg: 0 },
  sm: { xs: 1, sm: 2, md: 3, lg: 4 },
  md: { xs: 4, sm: 6, md: 8, lg: 10 },
  lg: { xs: 6, sm: 9, md: 12, lg: 16 },
};

export const RADIUS_LABELS: Readonly<Record<RadiusId, string>> = { none: 'None', sm: 'Small', md: 'Medium', lg: 'Large' };

/** CSS variable overrides for a roundness ('' for the stock one, so the default adds nothing — same as the accent). */
export function radiusCss(id: RadiusId): string {
  const safe = coerceRadius(id); // a hand-edited or corrupt value must never break the stylesheet
  if (safe === DEFAULT_RADIUS) return '';
  const r = RADIUS_SCALE[safe];
  return `html:root{--radius:${r.lg}px;--radius-xs:${r.xs}px;--radius-sm:${r.sm}px;--radius-md:${r.md}px;--radius-lg:${r.lg}px}`;
}
