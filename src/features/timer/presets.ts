/** Custom timers: a name, a length and an icon (or any emoji) — "Deep work 50", "Tea 4", "Reading 30". */
import {
  BookOpen,
  Brain,
  Briefcase,
  Code,
  Coffee,
  Dumbbell,
  Flame,
  Gamepad2,
  GraduationCap,
  Heart,
  Hourglass,
  Languages,
  Laptop,
  Leaf,
  type LucideIcon,
  Moon,
  Music,
  Palette,
  PenLine,
  Rocket,
  Sparkles,
  Sun,
  Target,
  Timer,
  Utensils,
  Zap,
} from 'lucide-react';

export type TimerPreset = {
  id: string;
  name: string;
  /** A key of PRESET_ICONS, or `emoji:<one emoji>`. */
  icon: string;
  minutes: number;
};

export const MAX_PRESETS = 12;
export const PRESET_MIN_MINUTES = 1;
export const PRESET_MAX_MINUTES = 120;
export const PRESET_NAME_MAX = 24;

export const PRESET_ICONS = {
  timer: Timer,
  brain: Brain,
  book: BookOpen,
  code: Code,
  laptop: Laptop,
  pen: PenLine,
  briefcase: Briefcase,
  school: GraduationCap,
  language: Languages,
  palette: Palette,
  music: Music,
  game: Gamepad2,
  workout: Dumbbell,
  coffee: Coffee,
  meal: Utensils,
  focus: Target,
  sprint: Zap,
  flame: Flame,
  rocket: Rocket,
  sparkles: Sparkles,
  leaf: Leaf,
  heart: Heart,
  sun: Sun,
  moon: Moon,
  hourglass: Hourglass,
} as const satisfies Record<string, LucideIcon>;

export const PRESET_ICON_KEYS = Object.keys(PRESET_ICONS) as Array<keyof typeof PRESET_ICONS>;
const EMOJI_PREFIX = 'emoji:';

export const DEFAULT_PRESETS: TimerPreset[] = [
  { id: 'preset-deep', name: 'Deep work', icon: 'brain', minutes: 50 },
  { id: 'preset-read', name: 'Reading', icon: 'book', minutes: 30 },
  { id: 'preset-sprint', name: 'Quick sprint', icon: 'sprint', minutes: 10 },
];

const firstGrapheme = (s: string): string => {
  const text = s.trim();
  if (!text) return '';
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) return part.segment;
  }
  return Array.from(text)[0] ?? '';
};

/** The first emoji in the text, or null when it holds none (so a stray letter can't become an "icon"). */
export function emojiOf(text: string): string | null {
  const g = firstGrapheme(text);
  return g && /\p{Extended_Pictographic}/u.test(g) ? g : null;
}

export const emojiIcon = (emoji: string) => `${EMOJI_PREFIX}${emoji}`;

export type ResolvedIcon = { kind: 'lucide'; Icon: LucideIcon } | { kind: 'emoji'; emoji: string };

export function resolveIcon(icon: string): ResolvedIcon {
  if (icon.startsWith(EMOJI_PREFIX)) {
    const e = emojiOf(icon.slice(EMOJI_PREFIX.length));
    if (e) return { kind: 'emoji', emoji: e };
  }
  return { kind: 'lucide', Icon: (PRESET_ICONS as Record<string, LucideIcon>)[icon] ?? Timer };
}

/** Clean up user input (and anything read back from storage): trimmed name, whole minutes in range, a known icon. */
export function sanitizePreset(input: { id: string; name: unknown; icon: unknown; minutes: unknown }): TimerPreset | null {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, PRESET_NAME_MAX) : '';
  if (!name) return null;
  const n = Number(input.minutes);
  const minutes = Number.isFinite(n) ? Math.min(PRESET_MAX_MINUTES, Math.max(PRESET_MIN_MINUTES, Math.round(n))) : 25;
  const raw = typeof input.icon === 'string' ? input.icon : 'timer';
  const icon = raw.startsWith(EMOJI_PREFIX)
    ? emojiOf(raw.slice(EMOJI_PREFIX.length))
      ? emojiIcon(emojiOf(raw.slice(EMOJI_PREFIX.length)) as string)
      : 'timer'
    : raw in PRESET_ICONS
      ? raw
      : 'timer';
  return { id: input.id, name, icon, minutes };
}
