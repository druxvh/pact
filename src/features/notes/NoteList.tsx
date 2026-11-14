import { FileText, Pin, Plus, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo } from 'react';
import { Avatar, Badge, Button, EmptyState, InputGroup, Kbd } from '@/components/ui';
import { excerpt, sortNotes } from '@/features/notes/store';
import type { Note } from '@/features/notes/types';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { spring } from '@/lib/motion';
import { findPerson } from '@/store/useUserStore';

type Props = {
  notes: Note[];
  query: string;
  onQuery: (q: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  notebookName: string;
  shared: boolean;
};

export function NoteList({ notes, query, onQuery, selectedId, onSelect, onNew, notebookName, shared }: Props) {
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? notes.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
      : notes;
    return sortNotes(list);
  }, [notes, query]);

  return (
    <section aria-label="Notes list" className="flex min-h-0 flex-col rounded-2xl border bg-card/60">
      <div className="flex items-center gap-2 border-b p-2.5">
        <InputGroup
          className="flex-1"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          leading={<Search />}
          trailing={
            query ? (
              <button type="button" aria-label="Clear search" onClick={() => onQuery('')} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent">
                <X className="size-3.5" />
              </button>
            ) : undefined
          }
          placeholder={`Search ${notebookName}…`}
          aria-label="Search notes"
          inputClassName="h-8 text-[13px]"
        />
      </div>

      {notes.length === 0 ? (
        <div className="grid flex-1 place-items-center p-4">
          <EmptyState
            icon={FileText}
            title="No notes yet"
            description={`Capture a thought in ${notebookName}.`}
            action={
              <Button variant="primary" size="sm" onClick={onNew}>
                <Plus /> New note <Kbd className="ml-1 border-brand-foreground/20 bg-brand-foreground/10 text-brand-foreground">N</Kbd>
              </Button>
            }
            className="w-full border-0"
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">No notes match “{query}”</div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
          <AnimatePresence initial={false}>
            {visible.map((n) => {
              const selected = n.id === selectedId;
              const assignee = n.assigneeId ? findPerson(n.assigneeId) : undefined;
              return (
                <motion.li
                  key={n.id}
                  layout="position"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={spring.soft}
                >
                  <button
                    type="button"
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => onSelect(n.id)}
                    className={cn(
                      'group relative w-full rounded-xl px-3 py-2.5 text-left outline-offset-[-2px] transition-colors duration-150 active:scale-[0.99]',
                      selected ? 'bg-brand-soft' : 'hover:bg-accent',
                    )}
                  >
                    {selected && <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-brand" />}
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{n.title.trim() || 'Untitled'}</span>
                      {n.pinned && <Pin className="size-3 shrink-0 fill-current text-brand-text" aria-label="Pinned" />}
                      <span className="shrink-0 text-[11px] text-subtle-foreground">{relativeTime(n.updatedAt)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                      {excerpt(n.body) || 'No content'}
                    </span>
                    {(shared || selected) && (
                      <span className="mt-1.5 flex items-center gap-1.5">
                        <Badge mono>#{n.number}</Badge>
                        {assignee && (
                          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Avatar name={assignee.displayName} size="xs" /> {assignee.username}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
