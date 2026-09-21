import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Note } from '@/types/note';

type NotesState = {
  notes: Note[];
  selectedId: string | null;
  query: string;
  setQuery: (q: string) => void;
  select: (id: string | null) => void;
  addNote: (title?: string, body?: string) => string;
  updateNote: (id: string, patch: Partial<Note>) => void;
  deleteNote: (id: string) => void;
};

const now = () => new Date().toISOString();

const seed: Note[] = [
  { id: 'n1', title: 'Pact ideas', body: 'Spaces sync kanban + notes + chats per friend group. Add by username → friend request → share. Keep it playful, black, fast.', updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
  { id: 'n2', title: 'Onboarding copy', body: 'Steps: 1) auth via Clerk/BetterAuth 2) username (unique) 3) designation 4) bio. Make it modern, fun, not corporate.', updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() },
  { id: 'n3', title: 'Utility tools list', body: 'x→y converters: length, temp, currency (mock rates), text case, url encode, color picker, QR, image compress ≤5mb.', updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString() },
  { id: 'n4', title: 'Chat vibe', body: 'Discord × Telegram: left dm list, main chat bubbles, emoji picker, gif, image/video ≤5mb, reply, reactions.', updatedAt: now() },
];

export const useNotesStore = create<NotesState>()(
  persist(
    (set) => ({
      notes: seed,
      selectedId: 'n1',
      query: '',
      setQuery: (query) => set({ query }),
      select: (selectedId) => set({ selectedId }),
      addNote: (title = 'Untitled', body = '') => {
        const id = crypto.randomUUID();
        const note: Note = { id, title, body, updatedAt: now() };
        set((s) => ({ notes: [note, ...s.notes], selectedId: id }));
        return id;
      },
      updateNote: (id, patch) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: now() } : n)),
        })),
      deleteNote: (id) =>
        set((s) => {
          const notes = s.notes.filter((n) => n.id !== id);
          const selectedId = s.selectedId === id ? (notes[0]?.id ?? null) : s.selectedId;
          return { notes, selectedId };
        }),
    }),
    { name: 'pact-notes' },
  ),
);
