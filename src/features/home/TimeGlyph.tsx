import { Moon, Sun, Sunrise, Sunset } from 'lucide-react';

export type TimeOfDay = 'sunrise' | 'sun' | 'sunset' | 'moon';

/** The sky as the greeting sees it: dawn, the long middle of the day, sundown, and everything after. */
export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 8) return 'sunrise';
  if (hour >= 8 && hour < 17) return 'sun';
  if (hour >= 17 && hour < 20) return 'sunset';
  return 'moon';
}

const ICONS = { sunrise: Sunrise, sun: Sun, sunset: Sunset, moon: Moon } as const;

/**
 * A small sun or moon before the greeting. Only Dusk draws it (the greeting asks the style first), so every other style is
 * untouched; its colour and its slow drift live in styles/dusk.css (`[data-glyph]`), where they stop for reduced motion.
 */
export function TimeGlyph({ hour }: { hour: number }) {
  const tod = timeOfDay(hour);
  const Icon = ICONS[tod];
  return (
    <span data-glyph={tod} aria-hidden="true" className="mr-2 inline-flex size-[1.1em] items-center justify-center align-[-0.17em]">
      <Icon className="size-full" strokeWidth={1.75} />
    </span>
  );
}
