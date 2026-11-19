import { type AccentChoice, baseColor } from '@/lib/appearance/accent';
import { oklchToHex } from '@/lib/oklch';

/** The accent as `#rrggbb` for a scene: a custom accent exactly as typed (the pipeline clamps its lightness for *text*; a wallpaper wants the pure colour), a preset in the current theme. */
export function accentHex(choice: AccentChoice, dark: boolean): string {
  return choice.kind === 'custom' ? choice.hex : oklchToHex(baseColor(choice, dark ? 'dark' : 'light'));
}
