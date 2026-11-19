import { Pin } from 'lucide-react';
import { Button } from '@/components/ui';
import { preview } from '@/features/home/widgets/noteText';
import { OpenLink, WidgetCard, WidgetEmpty } from '@/features/home/widgets/WidgetCard';
import { useNotesStore } from '@/features/notes/store';
import type { Note } from '@/features/notes/types';
import { relativeTime } from '@/lib/format';
import { useNavStore } from '@/store/useNavStore';

/** Notes you pinned, newest first. Opening one jumps to it in Notes. */
export function PinnedNotesWidget() {
  const notes = useNotesStore((s) => s.notes);
  const go = useNavStore((s) => s.go);
  const pinned = notes.filter((n) => n.pinned).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const open = (note: Note) => {
    const store = useNotesStore.getState();
    store.setActiveNotebook(note.notebookId);
    store.select(note.id);
    go('notes');
  };

  return (
    <WidgetCard icon={Pin} title="Pinned notes" action={pinned.length > 0 ? <OpenLink to="notes" label="Notes" /> : undefined}>
      {pinned.length === 0 ? (
        <WidgetEmpty
          action={
            <Button variant="soft" size="sm" onClick={() => go('notes')}>
              Open notes
            </Button>
          }
        >
          Pin a note and it will wait for you here.
        </WidgetEmpty>
      ) : (
        <ul className="-mx-1 space-y-0.5">
          {pinned.slice(0, 4).map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => open(n)} className="block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/60">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{n.title.trim() || 'Untitled'}</span>
                  <span className="shrink-0 text-[11px] text-subtle-foreground">{relativeTime(n.updatedAt)}</span>
                </span>
                {preview(n.body) && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{preview(n.body)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
