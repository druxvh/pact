import { create } from 'zustand';

export type NavSection =
  | 'home'
  | 'notes'
  | 'kanban'
  | 'timer'
  | 'tools'
  | 'chatrooms'
  | 'settings';

type NavState = {
  active: NavSection;
  setActive: (section: NavSection) => void;
};

export const useNavStore = create<NavState>((set) => ({
  active: 'home',
  setActive: (active) => set({ active }),
}));

export const NAV_LABELS: Record<NavSection, string> = {
  home: 'Home',
  notes: 'Notes',
  kanban: 'Kanban',
  timer: 'Timer',
  tools: 'Tools',
  chatrooms: 'Chatrooms',
  settings: 'Settings',
};
