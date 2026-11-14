import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Note, Notebook } from '@/types/note';
import { useUserStore } from '@/store/useUserStore';

type NotesState = {
  notebooks: Notebook[];
  activeNotebookId: string;
  notes: Note[];
  selectedId: string | null;
  query: string;
  setQuery: (q: string) => void;
  setActiveNotebook: (id: string) => void;
  createNotebook: (name: string, memberIds?: string[]) => string;
  deleteNotebook: (id: string) => void;
  inviteToNotebook: (notebookId: string, username: string) => { ok: boolean; msg: string };
  select: (id: string | null) => void;
  addNote: (title?: string, body?: string, notebookId?: string) => string;
  updateNote: (id: string, patch: Partial<Note>) => void;
  deleteNote: (id: string) => void;
  assignNote: (id: string, assigneeId: string | null) => void;
  moveNote: (activeId: string, overId: string | null) => void;
};

const now = () => new Date().toISOString();

const seedNotebooks: Notebook[] = [
  { id: 'nb-1', name: 'Personal', memberIds: ['local-user'], createdAt: now() },
  { id: 'nb-2', name: 'design jam', memberIds: ['local-user', 'alex', 'jordan'], createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString() },
  { id: 'nb-3', name: 'pact launch', memberIds: ['local-user', 'sam', 'riley'], createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() },
];

const seedNotes: Note[] = [
  { id: 'n1', notebookId: 'nb-1', number: 1, title: 'Pact ideas', body: 'Spaces sync kanban + notes + chats per friend group. Add by username → friend request → share. Keep it playful, black, fast.', assigneeId: null, createdAt: now(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
  { id: 'n2', notebookId: 'nb-1', number: 2, title: 'Onboarding copy', body: 'Steps: 1) auth via Clerk/BetterAuth 2) username (unique) 3) designation 4) bio. Make it modern, fun, not corporate.', assigneeId: 'local-user', createdAt: now(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() },
  { id: 'n3', notebookId: 'nb-2', number: 1, title: 'Utility tools list', body: 'x→y converters: length, temp, currency (mock rates), text case, url encode, color picker, QR, image compress ≤5mb.', assigneeId: 'alex', createdAt: now(), updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString() },
  { id: 'n4', notebookId: 'nb-2', number: 2, title: 'Chat vibe', body: 'Discord × Telegram: left dm list, main chat bubbles, emoji picker, gif, image/video ≤5mb, reply, reactions.', assigneeId: null, createdAt: now(), updatedAt: now() },
  { id: 'n5', notebookId: 'nb-3', number: 1, title: 'Kanban polish', body: 'Remove borders, dnd-kit smooth, per-board add, #numbers + assign, groups on top, invite flow.', assigneeId: 'jordan', createdAt: now(), updatedAt: now() },
];

export const useNotesStore = create<NotesState>()(
  persist(
    (set, get) => ({
      notebooks: seedNotebooks,
      activeNotebookId: 'nb-1',
      notes: seedNotes,
      selectedId: 'n1',
      query: '',
      setQuery: (query) => set({ query }),
      setActiveNotebook: (activeNotebookId) => set({ activeNotebookId, selectedId: null }),
      createNotebook: (name, memberIds = ['local-user']) => {
        const id = `nb-${crypto.randomUUID().slice(0, 8)}`;
        const nb: Notebook = { id, name: name.trim() || `Notebook ${get().notebooks.length + 1}`, memberIds, createdAt: now() };
        set((s) => ({ notebooks: [...s.notebooks, nb], activeNotebookId: id }));
        return id;
      },
      deleteNotebook: (id) =>
        set((s) => {
          const notebooks = s.notebooks.filter((b) => b.id !== id);
          const activeNotebookId = s.activeNotebookId === id ? (notebooks[0]?.id ?? s.notebooks[0]?.id ?? id) : s.activeNotebookId;
          const notes = s.notes.filter((n) => n.notebookId !== id);
          const selectedId = notes.find((n) => n.notebookId === activeNotebookId)?.id ?? null;
          return { notebooks: notebooks.length ? notebooks : s.notebooks, notes, activeNotebookId: activeNotebookId ?? s.activeNotebookId, selectedId };
        }),
      inviteToNotebook: (notebookId, username) => {
        const clean = username.replace(/^@/, '').trim().toLowerCase();
        if (!clean) return { ok: false, msg: 'Enter username' };
        const teammates = useUserStore.getState().teammates;
        const found = teammates.find((t) => t.username.toLowerCase() === clean);
        if (!found) return { ok: false, msg: `No user @${clean} (try alex/jordan/sam/riley)` };
        let ok = false;
        let msg = `Already in notebook`;
        set((s) => {
          const notebooks = s.notebooks.map((b) => {
            if (b.id !== notebookId) return b;
            if (b.memberIds.includes(found.id)) return b;
            ok = true;
            msg = `Added @${found.username}`;
            return { ...b, memberIds: [...b.memberIds, found.id] };
          });
          return { notebooks };
        });
        return { ok, msg };
      },
      select: (selectedId) => set({ selectedId }),
      addNote: (title = 'Untitled', body = '', notebookId) => {
        const nbId = notebookId ?? get().activeNotebookId;
        const boardNotes = get().notes.filter((n) => n.notebookId === nbId);
        const maxNum = boardNotes.reduce((m, n) => Math.max(m, n.number), 0);
        const id = crypto.randomUUID();
        const note: Note = { id, notebookId: nbId, number: maxNum + 1, title, body, assigneeId: null, createdAt: now(), updatedAt: now() };
        set((s) => ({ notes: [note, ...s.notes], selectedId: id }));
        return id;
      },
      updateNote: (id, patch) => set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: now() } : n)) })),
      deleteNote: (id) =>
        set((s) => {
          const notes = s.notes.filter((n) => n.id !== id);
          const selectedId = s.selectedId === id ? (notes.find((n) => n.notebookId === s.activeNotebookId)?.id ?? notes[0]?.id ?? null) : s.selectedId;
          return { notes, selectedId };
        }),
      assignNote: (id, assigneeId) => set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, assigneeId, updatedAt: now() } : n)) })),
      moveNote: (activeId, overId) =>
        set((s) => {
          if (!overId || activeId === overId) return s;
          const activeIdx = s.notes.findIndex((n) => n.id === activeId);
          const overIdx = s.notes.findIndex((n) => n.id === overId);
          if (activeIdx === -1 || overIdx === -1) return s;
          // only within same notebook
          const active = s.notes[activeIdx]!;
          const over = s.notes[overIdx]!;
          if (active.notebookId !== over.notebookId) return s;
          const newNotes = [...s.notes];
          const [moved] = newNotes.splice(activeIdx, 1);
          if (!moved) return s;
          const insertAt = activeIdx < overIdx ? overIdx - 1 : overIdx;
          newNotes.splice(insertAt, 0, moved);
          return { notes: newNotes };
        }),
    }),
    {
      name: 'pact-notes',
      version: 2,
      migrate: (persisted: any, _version) => {
        // migrate from v1 (no notebooks) to v2
        if (!persisted?.notebooks) {
          const oldNotes: any[] = persisted?.notes ?? seedNotes;
          // map old notes that had no notebookId/number
          const migrated = oldNotes.map((n: any, i: number) => ({
            id: n.id ?? crypto.randomUUID(),
            notebookId: n.notebookId ?? 'nb-1',
            number: n.number ?? i + 1,
            title: n.title ?? 'Untitled',
            body: n.body ?? '',
            assigneeId: n.assigneeId ?? null,
            createdAt: n.createdAt ?? now(),
            updatedAt: n.updatedAt ?? now(),
          }));
          return {
            notebooks: seedNotebooks,
            activeNotebookId: 'nb-1',
            notes: migrated,
            selectedId: migrated[0]?.id ?? null,
            query: persisted?.query ?? '',
          };
        }
        return persisted as any;
      },
    },
  ),
);
