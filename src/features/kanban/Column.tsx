import { useSortable } from '@dnd-kit/react/sortable';
import { Plus, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Badge, IconButton } from '@/components/ui';
import { SortableTaskCard } from '@/features/kanban/TaskCard';
import { type ColumnId, type Task, useKanbanStore } from '@/features/kanban/store';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import type { Person } from '@/types/user';

const DOT: Record<ColumnId, string> = {
  todo: 'bg-subtle-foreground',
  in_progress: 'bg-brand',
  done: 'bg-success',
};

type Props = {
  column: { id: ColumnId; title: string };
  index: number;
  boardId: string;
  ids: string[];
  tasksById: Map<string, Task>;
  memberById: Map<string, Person>;
  dragDisabled: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
};

export function KanbanColumn({ column, index, boardId, ids, tasksById, memberById, dragDisabled, onOpen, onDelete }: Props) {
  const addTask = useKanbanStore((s) => s.addTask);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  // The whole column is a drop target (so empty columns accept cards); only cards are draggable.
  const { ref, isDropTarget } = useSortable({
    id: column.id,
    index,
    type: 'column',
    accept: ['column', 'item'],
    collisionPriority: 1, // lower than cards, so hovering a card sorts relative to it
    disabled: { draggable: true },
  });

  const commit = () => {
    const t = draft.trim();
    if (!t) return;
    addTask(boardId, column.id, t);
    setDraft('');
  };

  return (
    <section
      ref={ref}
      aria-label={column.title}
      className={cn(
        'flex min-h-0 min-w-[280px] flex-1 flex-col rounded-2xl border bg-muted/40 transition-[border-color,background-color,box-shadow] duration-200',
        isDropTarget && 'border-brand/50 bg-brand-soft/50 shadow-[inset_0_0_0_1px_var(--brand-glow)]',
      )}
    >
      <header className="flex items-center gap-2 px-3 pb-1 pt-3">
        <span className={cn('size-2 rounded-full', DOT[column.id])} aria-hidden="true" />
        <h2 className="text-[13px] font-semibold tracking-tight">{column.title}</h2>
        <Badge mono>{ids.length}</Badge>
        <IconButton
          label={adding ? 'Cancel adding' : `Add task to ${column.title}`}
          size="icon-xs"
          className="ml-auto"
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? <X /> : <Plus />}
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2 pt-1">
        <AnimatePresence initial={false}>
          {adding && (
            <motion.div
              key="composer"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={spring.soft}
              className="overflow-hidden"
            >
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commit();
                  } else if (e.key === 'Escape') {
                    e.stopPropagation();
                    setDraft('');
                    setAdding(false);
                  }
                }}
                onBlur={() => !draft.trim() && setAdding(false)}
                placeholder="Task title — Enter to add, Esc to close"
                aria-label={`New task in ${column.title}`}
                className="h-10 w-full rounded-xl border border-input bg-card px-3 text-[13.5px] outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-4 focus:ring-ring/15"
              />
            </motion.div>
          )}
        </AnimatePresence>

        {ids.map((id, i) => {
          const task = tasksById.get(id);
          if (!task) return null;
          return (
            <SortableTaskCard
              key={id}
              task={task}
              index={i}
              assignee={task.assigneeId ? memberById.get(task.assigneeId) : undefined}
              dragDisabled={dragDisabled}
              onOpen={onOpen}
              onDelete={onDelete}
            />
          );
        })}

        {ids.length === 0 && !adding && (
          <div className="grid h-24 place-items-center rounded-xl border border-dashed text-xs text-subtle-foreground">
            Drop tasks here
          </div>
        )}
      </div>
    </section>
  );
}
