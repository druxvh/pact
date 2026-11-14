import { useSortable } from '@dnd-kit/react/sortable';
import { CalendarDays, Flag, Pencil, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { Avatar, Badge, IconButton } from '@/components/ui';
import { describeDue, type Priority, type Task } from '@/features/kanban/store';
import { cn } from '@/lib/cn';
import type { Person } from '@/types/user';

export const PRIORITY_META: Record<Priority, { label: string; className: string }> = {
  none: { label: 'No priority', className: 'text-subtle-foreground' },
  low: { label: 'Low', className: 'text-muted-foreground' },
  medium: { label: 'Medium', className: 'text-warning-text' },
  high: { label: 'High', className: 'text-destructive-text' },
};

const DUE_TONE = {
  overdue: 'bg-destructive-soft text-destructive-text',
  soon: 'bg-warning-soft text-warning-text',
  later: 'bg-muted text-muted-foreground',
} as const;

type Props = {
  task: Task;
  index: number;
  assignee?: Person;
  dragDisabled: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
};

export function SortableTaskCard({ task, index, assignee, dragDisabled, onOpen, onDelete }: Props) {
  const { ref, isDragging } = useSortable({
    id: task.id,
    index,
    group: task.columnId,
    type: 'item',
    accept: 'item',
    disabled: dragDisabled,
  });
  const done = task.columnId === 'done';
  const due = task.due ? describeDue(task.due, done) : null;
  // A drag that ends over the card must not also count as a click that opens the dialog.
  const draggedAt = useRef(0);
  if (isDragging) draggedAt.current = Date.now();

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users open the task with the Edit button; Enter/Space lift the card (dnd-kit)
    // biome-ignore lint/a11y/noStaticElementInteractions: the card is the drag handle (dnd-kit supplies role and keyboard support)
    <div
      ref={ref}
      data-dragging={isDragging || undefined}
      onClick={() => Date.now() - draggedAt.current > 200 && onOpen(task.id)}
      className={cn(
        'group relative cursor-grab select-none rounded-xl border bg-card p-3 shadow-xs active:cursor-grabbing',
        'transition-[border-color,box-shadow,background-color,opacity] duration-150 hover:border-foreground/20 hover:shadow-md',
        isDragging && 'z-50 cursor-grabbing border-brand/60 bg-card shadow-lg ring-2 ring-brand/30',
      )}
    >
      <div className="flex items-center gap-2">
        <Badge mono>#{task.number}</Badge>
        {task.priority !== 'none' && (
          <span className={cn('flex items-center gap-1 text-[11px] font-medium', PRIORITY_META[task.priority].className)}>
            <Flag className="size-3 fill-current" aria-hidden="true" />
            {PRIORITY_META[task.priority].label}
          </span>
        )}
        {due && (
          <span className={cn('ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium', DUE_TONE[due.tone])}>
            <CalendarDays className="size-3" aria-hidden="true" />
            {due.label}
          </span>
        )}
      </div>

      <p className={cn('mt-2 text-[13.5px] font-medium leading-snug', done && 'text-muted-foreground line-through decoration-muted-foreground/40')}>
        {task.title}
      </p>
      {task.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{task.description}</p>}

      <div className="mt-3 flex min-h-6 items-center justify-between gap-2">
        {assignee ? (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Avatar name={assignee.displayName} size="xs" />
            <span className="truncate">{assignee.username}</span>
          </span>
        ) : (
          <span />
        )}
        <span className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <IconButton
            label="Edit task"
            size="icon-xs"
            tooltip={false}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(task.id);
            }}
          >
            <Pencil />
          </IconButton>
          <IconButton
            label="Delete task"
            size="icon-xs"
            variant="danger"
            tooltip={false}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(task.id);
            }}
          >
            <Trash2 />
          </IconButton>
        </span>
      </div>
    </div>
  );
}
