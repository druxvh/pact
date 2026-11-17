/**
 * Quick capture: where a capture goes, what you used last, and the write itself.
 *
 * This module is shared by the in-app sheet (a Dialog) and the toolbar popup, which is a separate extension page. The popup
 * has no supabase session of its own — it writes straight into the same persisted stores the new tab uses. Extension pages
 * share localStorage, so an open pact tab picks the change up (`syncAcrossTabs`) and its notes-sync engine uploads it; with
 * no pact tab open, the next tab's first full pull sees a note the server has never heard of and uploads that.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  appendToDraft,
  type CaptureKind,
  type CaptureTarget,
  describeWhere,
  MAX_CAPTURE_CHARS,
  pickId,
  type SaveResult,
  splitTask,
} from '@/features/capture/capture';
import { useHomeLayoutStore } from '@/features/home/layout';
import { splitNote } from '@/features/home/widgets/noteText';
import { COLUMNS, type ColumnId, isColumnId, useKanbanStore } from '@/features/kanban/store';
import { useNotesStore } from '@/features/notes/store';
import type { Note } from '@/features/notes/types';
import { uid } from '@/lib/format';
import { syncAcrossTabs } from '@/lib/persist';

type CaptureState = CaptureTarget & {
  /** Last kind used — the sheet opens on it. */
  kind: CaptureKind;
  /** Text that was typed but never saved (the popup closes the moment it loses focus), so the next open continues it. */
  draft: string;
  setKind: (kind: CaptureKind) => void;
  setNotebook: (id: string) => void;
  setBoard: (id: string) => void;
  setColumn: (id: ColumnId) => void;
  setDraft: (draft: string) => void;
};

export const CAPTURE_KEY = 'pact-capture';

export const useCaptureStore = create<CaptureState>()(
  persist(
    (set) => ({
      kind: 'note',
      notebookId: null,
      boardId: null,
      columnId: 'todo',
      draft: '',
      setKind: (kind) => set({ kind }),
      setNotebook: (notebookId) => set({ notebookId }),
      setBoard: (boardId) => set({ boardId }),
      setColumn: (columnId) => set({ columnId }),
      setDraft: (draft) => set({ draft: draft.slice(0, MAX_CAPTURE_CHARS) }),
    }),
    {
      name: CAPTURE_KEY,
      version: 1,
      // Whatever is in storage (older build, hand edit, another account's leftovers) is coerced, never trusted.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Record<keyof CaptureState, unknown>>;
        const id = (v: unknown) => (typeof v === 'string' && v ? v : null);
        return {
          ...current,
          kind: p.kind === 'task' ? 'task' : 'note',
          notebookId: id(p.notebookId),
          boardId: id(p.boardId),
          columnId: isColumnId(p.columnId) ? p.columnId : 'todo',
          draft: typeof p.draft === 'string' ? p.draft.slice(0, MAX_CAPTURE_CHARS) : '',
        };
      },
    },
  ),
);

syncAcrossTabs(CAPTURE_KEY, useCaptureStore);

/** Where a capture would go right now: remembered choices that still exist, else the app's own defaults. */
export function currentTarget(): { notebookId: string | null; boardId: string | null; columnId: ColumnId } {
  const prefs = useCaptureStore.getState();
  const notes = useNotesStore.getState();
  const kanban = useKanbanStore.getState();
  return {
    notebookId: pickId(notes.notebooks, prefs.notebookId, notes.activeNotebookId),
    boardId: pickId(kanban.boards, prefs.boardId, kanban.activeBoardId),
    columnId: prefs.columnId,
  };
}

const columnTitle = (id: ColumnId) => COLUMNS.find((c) => c.id === id)?.title ?? id;

/**
 * Like `addNote`, but doesn't move the reader: `addNote` also selects the new note and switches notebook, which would yank
 * the editor away from whatever someone is typing in another pact tab the moment the capture lands there.
 */
function addNoteQuietly(notebookId: string, init: { title: string; body: string }): string {
  const nb = useNotesStore.getState().notebooks.find((b) => b.id === notebookId);
  if (!nb) return '';
  const id = uid('note');
  const stamp = new Date().toISOString();
  const note: Note = { id, notebookId: nb.id, number: nb.nextNumber, ...init, pinned: false, assigneeId: null, createdAt: stamp, updatedAt: stamp };
  useNotesStore.setState((s) => ({
    notes: [note, ...s.notes],
    notebooks: s.notebooks.map((b) => (b.id === nb.id ? { ...b, nextNumber: b.nextNumber + 1 } : b)),
  }));
  return id;
}

export type SaveInput = { kind: CaptureKind; text: string; account: boolean } & CaptureTarget;

/**
 * Write a capture. Signed-in: a note in the chosen notebook or a task in the chosen board column. Guest (no account, so
 * no Notes or Kanban): appended to Home's "Quick note", the one place a guest can keep text. Remembers the destination and
 * clears the unsent draft on success.
 */
export async function saveCapture(input: SaveInput): Promise<SaveResult> {
  const text = input.text.trim();
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > MAX_CAPTURE_CHARS) return { ok: false, reason: 'too-long' };

  // Another extension page (the popup, or a pact tab) may have written since this page loaded — start from what's stored.
  if (!input.account) {
    await useHomeLayoutStore.persist.rehydrate();
    const next = appendToDraft(useHomeLayoutStore.getState().draft, text);
    if (next === null) return { ok: false, reason: 'too-long' };
    useHomeLayoutStore.getState().setDraft(next);
    useCaptureStore.getState().setDraft('');
    return { ok: true, kind: 'draft', where: describeWhere({ home: true }) };
  }

  if (input.kind === 'task') {
    await useKanbanStore.persist.rehydrate();
    const kanban = useKanbanStore.getState();
    const board = kanban.boards.find((b) => b.id === pickId(kanban.boards, input.boardId, kanban.activeBoardId));
    if (!board) return { ok: false, reason: 'no-destination' };
    const { title, description } = splitTask(text);
    const id = kanban.addTask(board.id, input.columnId, title, { description });
    if (!id) return { ok: false, reason: 'no-destination' };
    useCaptureStore.setState({ kind: 'task', boardId: board.id, columnId: input.columnId, draft: '' });
    return { ok: true, kind: 'task', id, where: describeWhere({ board: board.name, column: columnTitle(input.columnId) }) };
  }

  await useNotesStore.persist.rehydrate();
  const notes = useNotesStore.getState();
  const nb = notes.notebooks.find((b) => b.id === pickId(notes.notebooks, input.notebookId, notes.activeNotebookId));
  if (!nb) return { ok: false, reason: 'no-destination' };
  const id = addNoteQuietly(nb.id, splitNote(text));
  if (!id) return { ok: false, reason: 'no-destination' };
  useCaptureStore.setState({ kind: 'note', notebookId: nb.id, draft: '' });
  return { ok: true, kind: 'note', id, where: describeWhere({ notebook: nb.name }) };
}

/** True when a Supabase session is stored on this device. Reads the same key as `lib/supabase/client.ts` without importing it. */
export const AUTH_KEY = 'pact-auth';
export function hasStoredAccount(): boolean {
  try {
    return localStorage.getItem(AUTH_KEY) !== null;
  } catch {
    return false;
  }
}
