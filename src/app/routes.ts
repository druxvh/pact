import {
  Clock3,
  Columns3,
  Disc3,
  House,
  type LucideIcon,
  MessageCircleMore,
  NotebookPen,
  Settings,
  Wrench,
} from 'lucide-react';
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
  { id: 'chat', label: 'Chat', description: 'Friends and groups', icon: MessageCircleMore, hotkey: 'c', bleed: true },
  { id: 'party', label: 'VibeParty', description: 'Watch YouTube together', icon: Disc3, hotkey: 'p' },
  { id: 'settings', label: 'Settings', description: 'Profile and preferences', icon: Settings, hotkey: 's' },
] as const;

export const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s])) as Record<Section, SectionMeta>;

export const baseTitle = (section: Section) => (section === 'home' ? 'pact' : `${SECTION_BY_ID[section].label} · pact`);

/** Every keyboard shortcut in one place — drives both the bindings and the help dialog. */
export type ShortcutDef = { keys: string[]; label: string; group: 'General' | 'Navigate' | 'Context' };

export const SHORTCUTS: readonly ShortcutDef[] = [
  { keys: [MOD_KEY, 'K'], label: 'Open command palette', group: 'General' },
  { keys: ['/'], label: 'Focus search (Home)', group: 'General' },
  { keys: ['?'], label: 'Keyboard shortcuts', group: 'General' },
  { keys: ['Esc'], label: 'Close dialog / menu', group: 'General' },
  ...SECTIONS.map(
    (s): ShortcutDef => ({ keys: ['G', s.hotkey.toUpperCase()], label: `Go to ${s.label}`, group: 'Navigate' }),
  ),
  { keys: ['N'], label: 'New note / task / chat (current page)', group: 'Context' },
  { keys: ['Space'], label: 'Start / pause timer (Focus)', group: 'Context' },
  { keys: ['R'], label: 'Reset timer (Focus)', group: 'Context' },
];
