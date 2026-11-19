import { Clock3, Columns3, Disc3, House, type LucideIcon, MessageCircleMore, Newspaper, NotebookPen, Settings, Wrench } from 'lucide-react';
import { defaultCaptureKeys } from '@/features/capture/shortcut';
import { MOD_KEY } from '@/lib/hotkeys';
import type { Section } from '@/store/useNavStore';

export type SectionMeta = {
  id: Section;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Second key of the `g <key>` navigation shortcut. */
  hotkey: string;
  /** Renders edge-to-edge (the view manages its own padding/scrolling). */
  bleed?: boolean;
};

export const SECTIONS: readonly SectionMeta[] = [
  { id: 'home', label: 'Home', description: 'Search and your shortcuts', icon: House, hotkey: 'h', bleed: true },
  { id: 'notes', label: 'Notes', description: 'Notebooks you can share', icon: NotebookPen, hotkey: 'n', bleed: true },
  { id: 'kanban', label: 'Kanban', description: 'Boards and tasks', icon: Columns3, hotkey: 'k', bleed: true },
  { id: 'timer', label: 'Focus', description: 'Pomodoro timer and stats', icon: Clock3, hotkey: 't' },
  { id: 'tools', label: 'Tools', description: 'Tiny, private utilities', icon: Wrench, hotkey: 'o' },
  { id: 'discover', label: 'Discover', description: 'News and articles you’ll actually read', icon: Newspaper, hotkey: 'd' },
  { id: 'chat', label: 'Chat', description: 'Friends and groups', icon: MessageCircleMore, hotkey: 'c', bleed: true },
  { id: 'party', label: 'VibeParty', description: 'Watch YouTube together', icon: Disc3, hotkey: 'p' },
  { id: 'settings', label: 'Settings', description: 'Profile and preferences', icon: Settings, hotkey: 's' },
] as const;

/** What guests can use without an account: search, shortcuts and recent sites live on Home. Everything else needs sign-in. */
export const GUEST_SECTIONS: readonly Section[] = ['home'];
export const needsAccount = (section: Section) => !GUEST_SECTIONS.includes(section);

export const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s])) as Record<Section, SectionMeta>;

export const baseTitle = (section: Section) => (section === 'home' ? 'pact' : `${SECTION_BY_ID[section].label} · pact`);

/** Every keyboard shortcut in one place — drives both the bindings and the help dialog. */
export type ShortcutDef = { keys: string[]; label: string; group: 'General' | 'Navigate' | 'Context' };

export const SHORTCUTS: readonly ShortcutDef[] = [
  { keys: [MOD_KEY, 'K'], label: 'Open the omnibox — on Home it focuses the search', group: 'General' },
  { keys: ['/'], label: 'Focus search (Home)', group: 'General' },
  { keys: ['C'], label: 'Quick capture a note or task', group: 'General' },
  { keys: defaultCaptureKeys(), label: 'Quick capture from any tab (browser shortcut)', group: 'General' },
  { keys: ['?'], label: 'Keyboard shortcuts', group: 'General' },
  { keys: ['Esc'], label: 'Close dialog / menu', group: 'General' },
  { keys: [MOD_KEY, '/'], label: 'Search box: actions for the highlighted result (or →)', group: 'General' },
  { keys: [MOD_KEY, '↵'], label: 'Search box: secondary action (e.g. new tab)', group: 'General' },
  { keys: ['Tab'], label: 'Search box: site chip (yt, gh…) / accept the grey completion', group: 'General' },
  { keys: ['⌫'], label: 'Search box: remove the site chip', group: 'General' },
  ...SECTIONS.map((s): ShortcutDef => ({ keys: ['G', s.hotkey.toUpperCase()], label: `Go to ${s.label}`, group: 'Navigate' })),
  { keys: ['N'], label: 'New note / task / chat (current page)', group: 'Context' },
  { keys: ['Space'], label: 'Start / pause timer (Focus)', group: 'Context' },
  { keys: ['R'], label: 'Reset timer (Focus)', group: 'Context' },
  { keys: ['J'], label: 'Next story (Discover)', group: 'Context' },
  { keys: ['K'], label: 'Previous story (Discover)', group: 'Context' },
  { keys: ['↵'], label: 'Open the story in the reader (Discover)', group: 'Context' },
  { keys: ['S'], label: 'Save the story to your reading list (Discover)', group: 'Context' },
  { keys: ['O'], label: 'Open the original article (Discover)', group: 'Context' },
  { keys: ['/'], label: 'Search stories (Discover)', group: 'Context' },
];
