import { Segmented } from '@/components/ui';
import { RADIUS_IDS, RADIUS_LABELS, type RadiusId } from '@/lib/appearance/radius';
import { useAppearanceStore } from '@/store/useAppearanceStore';
import { ScrollX, SettingsRow } from './ui';

/** Radius of the icon's top-left corner in its 24-unit box (the square is 18 wide): a ladder that stays readable at ~18 px — sharp, slight, soft, round. */
const ICON_R: Record<RadiusId, number> = { none: 0, sm: 3, md: 7, lg: 12 };

/**
 * A square outline whose top-left corner is drawn with the radius it stands for (same 24 box and 2 px round stroke as the
 * lucide icons beside it, so it sits in a Segmented control like any other icon).
 */
export function RoundnessIcon({ radius, className }: { radius: RadiusId; className?: string }) {
  const r = ICON_R[radius];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={`M${3 + r} 3H21V21H3V${3 + r}${r ? `A${r} ${r} 0 0 1 ${3 + r} 3` : ''}Z`} />
    </svg>
  );
}

/** A line made of real components — so the preview can never disagree with what you get (it reads the same radius tokens). */
function Preview() {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5" aria-hidden="true">
      <span className="flex items-center gap-1.5">
        <span className="h-6 w-9 rounded-md bg-brand" />
        <span className="h-6 w-12 rounded-md border border-foreground/25 bg-muted" />
        <span className="h-6 w-8 rounded-lg border border-foreground/25 bg-card shadow-xs" />
      </span>
      <span>Buttons, cards and inputs</span>
    </span>
  );
}

/** Settings → Appearance → Roundness: how sharp or soft every corner in pact is. */
export function RoundnessRow() {
  const radius = useAppearanceStore((s) => s.radius);
  const setRadius = useAppearanceStore((s) => s.setRadius);
  return (
    <SettingsRow label="Roundness" description={<Preview />}>
      <ScrollX>
        <Segmented<RadiusId>
          aria-label="Corner roundness"
          value={radius}
          onValueChange={setRadius}
          options={RADIUS_IDS.map((id) => ({ value: id, label: RADIUS_LABELS[id], icon: <RoundnessIcon radius={id} className="size-[18px]!" /> }))}
        />
      </ScrollX>
    </SettingsRow>
  );
}
