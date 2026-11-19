import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Note, Notebook } from '@/features/notes/types';
import { uid } from '@/lib/format';
import { syncAcrossTabs } from '@/lib/persist';
import { resolveInvite } from '@/store/members';
import { ME_ID } from '@/store/useUserStore';

const now = () => new Date().toISOString();

export const DEFAULT_NOTEBOOK_ID = 'nb-personal';

const defaultNotebook = (): Notebook => ({
  id: DEFAULT_NOTEBOOK_ID,
  name: 'Personal',
  memberIds: [ME_ID],
  nextNumber: 1,
  createdAt: now(),
});

export type NotebookSnapshot = { notebook: Notebook; notes: Note[] };

type NotesState = {
  notebooks: Notebook[];
  notes: Note[];
  activeNotebookId: string;
  selectedId: string | null;
  /** Ephemeral — intentionally not persisted. */
  query: string;

  setQuery: (q: string) => void;
  setActiveNotebook: (id: string) => void;
  select: (id: string | null) => void;

  createNotebook: (name: string) => string;
  renameNotebook: (id: string, name: string) => void;
  /** Refuses to delete the last notebook. Returns a snapshot for undo. */
  deleteNotebook: (id: string) => NotebookSnapshot | null;
  restoreNotebook: (snapshot: NotebookSnapshot) => void;
  inviteToNotebook: (notebookId: string, username: string) => { ok: boolean; msg: string; personId?: string };
  removeMember: (notebookId: string, personId: string) => void;

  addNote: (init?: Partial<Pick<Note, 'title' | 'body'>>, notebookId?: string) => string;
  updateNote: (id: string, patch: Partial<Pick<Note, 'title' | 'body' | 'pinned' | 'assigneeId'>>) => void;
  deleteNote: (id: string) => Note | null;
  restoreNote: (note: Note) => void;
};

const nextSelection = (notes: Note[], notebookId: string, excluding?: string): string | null =>
  notes.find((n) => n.notebookId === notebookId && n.id !== excluding)?.id ?? null;

export const useNotesStore = create<NotesState>()(
  persist(
    (set, get) => ({
      notebooks: [defaultNotebook()],
      notes: [],
      activeNotebookId: DEFAULT_NOTEBOOK_ID,
      selectedId: null,
      query: '',

      setQuery: (query) => set({ query }),
      setActiveNotebook: (id) =>
        set((s) => ({
          activeNotebookId: id,
          query: '',
          selectedId: nextSelection(sortNotes(s.notes.filter((n) => n.notebookId === id)), id),
        })),
      select: (selectedId) => set({ selectedId }),

      createNotebook: (name) => {
        const id = uid('nb');
        const nb: Notebook = {
          id,
          name: name.trim() || `Notebook ${get().notebooks.length + 1}`,
          memberIds: [ME_ID],
          nextNumber: 1,
          createdAt: now(),
        };
        set((s) => ({ notebooks: [...s.notebooks, nb], activeNotebookId: id, selectedId: null, query: '' }));
        return id;
      },

      renameNotebook: (id, name) => {
        const v = name.trim();
        if (!v) return;
        set((s) => ({ notebooks: s.notebooks.map((b) => (b.id === id ? { ...b, name: v } : b)) }));
      },

      deleteNotebook: (id) => {
        const s = get();
        if (s.notebooks.length <= 1) return null;
        const notebook = s.notebooks.find((b) => b.id === id);
        if (!notebook) return null;
        const removedNotes = s.notes.filter((n) => n.notebookId === id);
        const notebooks = s.notebooks.filter((b) => b.id !== id);
        const activeNotebookId = s.activeNotebookId === id ? (notebooks[0]?.id ?? DEFAULT_NOTEBOOK_ID) : s.activeNotebookId;
        const notes = s.notes.filter((n) => n.notebookId !== id);
        set({
          notebooks,
          notes,
          activeNotebookId,
          selectedId:
            s.activeNotebookId === id ? nextSelection(sortNotes(notes.filter((n) => n.notebookId === activeNotebookId)), activeNotebookId) : s.selectedId,
        });
        return { notebook, notes: removedNotes };
      },

      restoreNotebook: ({ notebook, notes }) =>
        set((s) =>
          s.notebooks.some((b) => b.id === notebook.id)
            ? s
            : { notebooks: [...s.notebooks, notebook], notes: [...s.notes, ...notes], activeNotebookId: notebook.id, selectedId: notes[0]?.id ?? null },
        ),

      inviteToNotebook: (notebookId, username) => {
        const nb = get().notebooks.find((b) => b.id === notebookId);
        if (!nb) return { ok: false, msg: 'Notebook not found' };
        const r = resolveInvite(nb.memberIds, username);
        if (!r.ok) return r;
        set((s) => ({
          notebooks: s.notebooks.map((b) => (b.id === notebookId ? { ...b, memberIds: [...b.memberIds, r.person.id] } : b)),
        }));
        return { ok: true, msg: r.msg, personId: r.person.id };
      },

      removeMember: (notebookId, personId) =>
        set((s) => ({
          notebooks: s.notebooks.map((b) => (b.id === notebookId && personId !== ME_ID ? { ...b, memberIds: b.memberIds.filter((m) => m !== personId) } : b)),
          // Anything assigned to the removed person becomes unassigned.
          notes: s.notes.map((n) => (n.notebookId === notebookId && n.assigneeId === personId ? { ...n, assigneeId: null } : n)),
        })),

      addNote: (init, notebookId) => {
        const s = get();
        const nbId = notebookId ?? s.activeNotebookId;
        const nb = s.notebooks.find((b) => b.id === nbId) ?? s.notebooks[0];
        if (!nb) return '';
        const id = uid('note');
        const stamp = now();
        const note: Note = {
          id,
          notebookId: nb.id,
          number: nb.nextNumber,
          title: init?.title ?? '',
          body: init?.body ?? '',
          pinned: false,
          assigneeId: null,
          createdAt: stamp,
          updatedAt: stamp,
        };
        set((st) => ({
          notes: [note, ...st.notes],
          notebooks: st.notebooks.map((b) => (b.id === nb.id ? { ...b, nextNumber: b.nextNumber + 1 } : b)),
          activeNotebookId: nb.id,
          selectedId: id,
          query: '',
        }));
        return id;
      },

      updateNote: (id, patch) =>
        set((s) => ({
          notes: s.notes.map((n) => {
            if (n.id !== id) return n;
            const touchesContent = patch.title !== undefined || patch.body !== undefined;
            return { ...n, ...patch, updatedAt: touchesContent ? now() : n.updatedAt };
          }),
        })),

      deleteNote: (id) => {
        const s = get();
        const note = s.notes.find((n) => n.id === id);
        if (!note) return null;
        const notes = s.notes.filter((n) => n.id !== id);
        set({
          notes,
          selectedId: s.selectedId === id ? nextSelection(sortNotes(notes.filter((n) => n.notebookId === note.notebookId)), note.notebookId) : s.selectedId,
        });
        return note;
      },

      restoreNote: (note) =>
        set((s) => (s.notes.some((n) => n.id === note.id) ? s : { notes: [...s.notes, note], activeNotebookId: note.notebookId, selectedId: note.id })),
    }),
    {
      name: 'pact-notes',
      version: 3,
      partialize: (s) => ({
        notebooks: s.notebooks,
        notes: s.notes,
        activeNotebookId: s.activeNotebookId,
        selectedId: s.selectedId,
      }),
      migrate: (persisted) => {
        // v1: flat notes. v2: notebooks + numbered notes. v3: counters + pinning.
        const p = (persisted ?? {}) as { notebooks?: Notebook[]; notes?: Array<Partial<Note>>; activeNotebookId?: string; selectedId?: string | null };
        const baseNotebooks = p.notebooks?.length ? p.notebooks : [defaultNotebook()];
        const notes: Note[] = (p.notes ?? []).map((n, i) => ({
          id: n.id ?? uid('note'),
          notebookId: n.notebookId ?? baseNotebooks[0]?.id ?? DEFAULT_NOTEBOOK_ID,
          number: n.number ?? i + 1,
          title: n.title ?? '',
          body: n.body ?? '',
          pinned: n.pinned ?? false,
          assigneeId: n.assigneeId ?? null,
          createdAt: n.createdAt ?? now(),
          updatedAt: n.updatedAt ?? now(),
        }));
        const notebooks: Notebook[] = baseNotebooks.map((b) => ({
          ...b,
          nextNumber: (b as Partial<Notebook>).nextNumber ?? notes.filter((n) => n.notebookId === b.id).reduce((m, n) => Math.max(m, n.number), 0) + 1,
        }));
        return {
          notebooks,
          notes,
          activeNotebookId: notebooks.some((b) => b.id === p.activeNotebookId) ? (p.activeNotebookId as string) : (notebooks[0]?.id ?? DEFAULT_NOTEBOOK_ID),
          selectedId: p.selectedId ?? null,
        } as NotesState;
      },
    },
  ),
);

syncAcrossTabs('pact-notes', useNotesStore);

/** Pinned first, then most recently edited. */
export function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}

/** Plain-text excerpt for list previews (markdown punctuation stripped). */
export function excerpt(body: string, max = 140): string {
  const flat = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/[#>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}
