import { CircleCheck, FileText, ListTodo } from 'lucide-react';
import type { PaletteItem } from '@/app/CommandPalette';
import { COLUMNS, useKanbanStore } from '@/features/kanban/store';
import { excerpt, useNotesStore } from '@/features/notes/store';
import { useNavStore } from '@/store/useNavStore';
import { useUiStore } from '@/store/useUiStore';

/**
 * Feature data surfaced in the command palette (notes, tasks, chats…).
 * Each feature adds a block here; the palette itself stays generic.
 */
export function buildDataItems(query: string): PaletteItem[] {
  const q = query.trim();
  if (!q) return [];
  const items: PaletteItem[] = [];

  // Notes
  const { notes, notebooks } = useNotesStore.getState();
  for (const n of notes) {
    const nb = notebooks.find((b) => b.id === n.notebookId);
    items.push({
      id: `note-${n.id}`,
      group: 'Notes',
      label: n.title.trim() || 'Untitled',
      hint: `${nb?.name ?? 'Notebook'} · ${excerpt(n.body, 60) || 'No content'}`,
      keywords: n.body.slice(0, 400),
      icon: FileText,
      run: () => {
        const s = useNotesStore.getState();
        s.setActiveNotebook(n.notebookId);
        s.select(n.id);
        useNavStore.getState().go('notes');
      },
    });
  }

  // Tasks
  const { tasks, boards } = useKanbanStore.getState();
  for (const t of tasks) {
    const board = boards.find((b) => b.id === t.boardId);
    const col = COLUMNS.find((c) => c.id === t.columnId);
    items.push({
      id: `task-${t.id}`,
      group: 'Tasks',
      label: t.title,
      hint: `#${t.number} · ${board?.name ?? 'Board'} · ${col?.title ?? ''}`,
      keywords: `${t.description} #${t.number}`,
      icon: t.columnId === 'done' ? CircleCheck : ListTodo,
      run: () => {
        useKanbanStore.getState().setActiveBoard(t.boardId);
        useUiStore.getState().setPendingTaskId(t.id);
        useNavStore.getState().go('kanban');
      },
    });
  }

  return items;
}
