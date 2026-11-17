/**
 * What Home shows and how: the clock, the search box, shortcuts and a row of optional widgets.
 *
 * A *preset* is just a named `HomeLayout` — picking one overwrites the layout, and any later tweak makes it "Custom"
 * (`presetOf` compares, so there's no second source of truth to drift). Anything coming from storage is run through
 * `sanitizeLayout`, so an old/hand-edited/imported value can never break the page.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { syncAcrossTabs } from '@/lib/persist';

export const CLOCK_STYLES = ['digital', 'compact', 'analog', 'none'] as const;
export type ClockStyle = (typeof CLOCK_STYLES)[number];

export const WIDGET_IDS = ['mainFocus', 'today', 'focus', 'pinned', 'quickNote', 'quote', 'countdown'] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export const WIDGET_INFO: Record<WidgetId, { label: string; description: string }> = {
  mainFocus: { label: 'Main focus', description: 'One intention for the day, checked off when it’s done — with a streak.' },
  today: { label: 'Today', description: 'Tasks that are overdue, due today or in progress.' },
  focus: { label: 'Focus', description: 'Minutes focused today and your streak.' },
  pinned: { label: 'Pinned notes', description: 'The notes you pinned, one click away.' },
  quickNote: { label: 'Quick note', description: 'Jot something down and save it as a note.' },
  quote: { label: 'Quote of the day', description: 'A new line to think about each day.' },
  countdown: { label: 'Countdown', description: 'Days left until something you’re looking forward to.' },
};

export type HomeLayout = {
  clockStyle: ClockStyle;
  showSeconds: boolean;
  showDate: boolean;
  showSearch: boolean;
  showShortcuts: boolean;
  /** The “Press / to search” line. */
  showHints: boolean;
  /** Enabled widgets, in display order. */
  widgets: WidgetId[];
};

export type PresetId = 'classic' | 'minimal' | 'dashboard' | 'zen' | 'focus';

export type HomePreset = { id: PresetId; label: string; description: string; layout: HomeLayout };

export const PRESETS: readonly HomePreset[] = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'Big clock, search and your shortcuts.',
    layout: { clockStyle: 'digital', showSeconds: false, showDate: true, showSearch: true, showShortcuts: true, showHints: true, widgets: [] },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    description: 'A small clock and a search box. Nothing else.',
    layout: { clockStyle: 'compact', showSeconds: false, showDate: true, showSearch: true, showShortcuts: false, showHints: false, widgets: [] },
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    description: 'Everything at a glance: your main focus, tasks, focus time and a quote.',
    layout: {
      clockStyle: 'digital',
      showSeconds: false,
      showDate: true,
      showSearch: true,
      showShortcuts: true,
      showHints: false,
      widgets: ['mainFocus', 'today', 'focus', 'quote'],
    },
  },
  {
    id: 'zen',
    label: 'Zen',
    description: 'A calm analog clock and a single line to think about.',
    layout: {
      clockStyle: 'analog',
      showSeconds: true,
      showDate: true,
      showSearch: false,
      showShortcuts: false,
      showHints: false,
      widgets: ['quote'],
    },
  },
  {
    id: 'focus',
    label: 'Focus',
    description: 'Your main focus, next task, focus time and a scratch pad.',
    layout: {
      clockStyle: 'compact',
      showSeconds: false,
      showDate: false,
      showSearch: false,
      showShortcuts: false,
      showHints: false,
      widgets: ['mainFocus', 'today', 'focus', 'quickNote'],
    },
  },
];

export const DEFAULT_PRESET_ID: PresetId = 'classic';

const cloneLayout = (l: HomeLayout): HomeLayout => ({ ...l, widgets: [...l.widgets] });

export const presetLayout = (id: PresetId): HomeLayout => cloneLayout((PRESETS.find((p) => p.id === id) ?? (PRESETS[0] as HomePreset)).layout);

export const DEFAULT_LAYOUT: HomeLayout = presetLayout(DEFAULT_PRESET_ID);

const sameLayout = (a: HomeLayout, b: HomeLayout) =>
  a.clockStyle === b.clockStyle &&
  a.showSeconds === b.showSeconds &&
  a.showDate === b.showDate &&
  a.showSearch === b.showSearch &&
  a.showShortcuts === b.showShortcuts &&
  a.showHints === b.showHints &&
  a.widgets.length === b.widgets.length &&
  a.widgets.every((w, i) => w === b.widgets[i]);

/**
 * Widget lists a preset had before it gained a widget. A layout saved from one still counts as that preset — the picker keeps
 * highlighting it — without its Home changing under the person (presets are snapshots; nothing migrates stored layouts).
 */
const LEGACY_WIDGETS: Partial<Record<PresetId, ReadonlyArray<readonly WidgetId[]>>> = {
  dashboard: [['today', 'focus', 'quote']],
  focus: [['today', 'focus', 'quickNote']],
};

/** Which preset the layout currently equals, or `'custom'`. */
export function presetOf(layout: HomeLayout): PresetId | 'custom' {
  const match = PRESETS.find(
    (p) => sameLayout(p.layout, layout) || LEGACY_WIDGETS[p.id]?.some((widgets) => sameLayout({ ...p.layout, widgets: [...widgets] }, layout)),
  );
  return match?.id ?? 'custom';
}

/**
 * What a guest sees on Home. Widgets normally read account data (tasks, notes, the timer), so guests get none of those — only
 * the two that live entirely on this device: the day's main focus, and the Quick note (where quick capture puts a guest's text).
 */
export const GUEST_WIDGETS: readonly WidgetId[] = ['mainFocus', 'quickNote'];

export const visibleWidgets = (widgets: readonly WidgetId[], signedIn: boolean): WidgetId[] => [...(signedIn ? widgets : GUEST_WIDGETS)];

const isWidgetId = (v: unknown): v is WidgetId => (WIDGET_IDS as readonly unknown[]).includes(v);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Coerce anything (old versions, imports, hand edits) into a valid layout; unknown bits fall back to the default. */
export function sanitizeLayout(raw: unknown): HomeLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_LAYOUT;
  const widgets = Array.isArray(r.widgets) ? [...new Set(r.widgets.filter(isWidgetId))] : d.widgets;
  return {
    clockStyle: (CLOCK_STYLES as readonly unknown[]).includes(r.clockStyle) ? (r.clockStyle as ClockStyle) : d.clockStyle,
    showSeconds: bool(r.showSeconds, d.showSeconds),
    showDate: bool(r.showDate, d.showDate),
    showSearch: bool(r.showSearch, d.showSearch),
    showShortcuts: bool(r.showShortcuts, d.showShortcuts),
    showHints: bool(r.showHints, d.showHints),
    widgets: [...widgets],
  };
}

/** Turn a widget on (appended) or off. */
export function toggleWidget(widgets: readonly WidgetId[], id: WidgetId): WidgetId[] {
  return widgets.includes(id) ? widgets.filter((w) => w !== id) : [...widgets, id];
}

/** Move an enabled widget one place earlier (-1) or later (+1); a no-op at the ends or if it's off. */
export function moveWidget(widgets: readonly WidgetId[], id: WidgetId, dir: -1 | 1): WidgetId[] {
  const i = widgets.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= widgets.length) return [...widgets];
  const next = [...widgets];
  const a = next[i] as WidgetId;
  next[i] = next[j] as WidgetId;
  next[j] = a;
  return next;
}

/** Every widget for the settings list: enabled ones in their order, then the rest in the canonical order. */
export const orderedWidgets = (enabled: readonly WidgetId[]): WidgetId[] => [...enabled, ...WIDGET_IDS.filter((w) => !enabled.includes(w))];

export type Countdown = { title: string /** Local calendar date, `YYYY-MM-DD`. */; date: string | null };
export const NO_COUNTDOWN: Countdown = { title: '', date: null };

/** Whole calendar days from `now` to `date` (`YYYY-MM-DD`): 0 = today, negative = past. `null` if the date is invalid. */
export function daysUntil(date: string | null, now = new Date()): number | null {
  const m = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const target = Date.UTC(y, mo - 1, d);
  if (Number.isNaN(target) || new Date(target).getUTCMonth() !== mo - 1) return null; // e.g. 2025-02-31
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86_400_000);
}

export function sanitizeCountdown(raw: unknown): Countdown {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const title = typeof r.title === 'string' ? r.title.slice(0, 40) : '';
  const date = typeof r.date === 'string' && daysUntil(r.date) !== null ? r.date : null;
  return { title, date };
}

type HomeLayoutState = {
  layout: HomeLayout;
  countdown: Countdown;
  /** The quick-note widget's unsaved text, kept so a new tab doesn't lose it. */
  draft: string;

  setLayout: (patch: Partial<HomeLayout>) => void;
  applyPreset: (id: PresetId) => void;
  toggleWidget: (id: WidgetId) => void;
  moveWidget: (id: WidgetId, dir: -1 | 1) => void;
  setCountdown: (patch: Partial<Countdown>) => void;
  setDraft: (draft: string) => void;
  resetLayout: () => void;
};

export const useHomeLayoutStore = create<HomeLayoutState>()(
  persist(
    (set) => ({
      layout: cloneLayout(DEFAULT_LAYOUT),
      countdown: NO_COUNTDOWN,
      draft: '',

      setLayout: (patch) => set((s) => ({ layout: sanitizeLayout({ ...s.layout, ...patch }) })),
      applyPreset: (id) => set({ layout: presetLayout(id) }),
      toggleWidget: (id) => set((s) => ({ layout: { ...s.layout, widgets: toggleWidget(s.layout.widgets, id) } })),
      moveWidget: (id, dir) => set((s) => ({ layout: { ...s.layout, widgets: moveWidget(s.layout.widgets, id, dir) } })),
      setCountdown: (patch) => set((s) => ({ countdown: { ...s.countdown, ...patch } })),
      setDraft: (draft) => set({ draft }),
      resetLayout: () => set({ layout: cloneLayout(DEFAULT_LAYOUT) }),
    }),
    {
      name: 'pact-home-layout',
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<HomeLayoutState>;
        return {
          ...current,
          layout: p.layout ? sanitizeLayout(p.layout) : current.layout,
          countdown: sanitizeCountdown(p.countdown),
          draft: typeof p.draft === 'string' ? p.draft : '',
        };
      },
    },
  ),
);

syncAcrossTabs('pact-home-layout', useHomeLayoutStore);
