import { FileText } from 'lucide-react';
import type { PaletteItem } from '@/app/CommandPalette';
import { excerpt, useNotesStore } from '@/features/notes/store';
import { useNavStore } from '@/store/useNavStore';

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

  return items;
}
