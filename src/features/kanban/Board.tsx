import { DragDropProvider } from '@dnd-kit/react';
import { move } from '@dnd-kit/helpers';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KanbanColumn } from '@/features/kanban/Column';
import { COLUMNS, type ColumnId, type Task, columnTasks, useKanbanStore } from '@/features/kanban/store';
import type { Person } from '@/types/user';

type Grouped = Record<ColumnId, string[]>;

type Props = {
  boardId: string;
  /** Tasks currently visible (already filtered). */
  tasks: Task[];
  members: Person[];
  /** Dragging is paused while a filter is active (indices would no longer match the full column). */
  dragDisabled: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
};

export function Board({ boardId, tasks, members, dragDisabled, onOpen, onDelete }: Props) {
  const moveTask = useKanbanStore((s) => s.moveTask);

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const grouped = useMemo<Grouped>(
    () => ({
      todo: columnTasks(tasks, boardId, 'todo').map((t) => t.id),
      in_progress: columnTasks(tasks, boardId, 'in_progress').map((t) => t.id),
      done: columnTasks(tasks, boardId, 'done').map((t) => t.id),
    }),
    [tasks, boardId],
  );

  // Local mirror of the column order: lets cards reshuffle live while dragging,
  // and the store is written exactly once on drop.
  const [items, setItems] = useState<Grouped>(grouped);
  const latest = useRef<Grouped>(grouped);
  const snapshot = useRef<Grouped>(grouped);
  const dragging = useRef(false);

  useEffect(() => {
    if (dragging.current) return;
    latest.current = grouped;
    setItems(grouped);
  }, [grouped]);

  return (
    <DragDropProvider
      onDragStart={() => {
        dragging.current = true;
        snapshot.current = latest.current;
      }}
      onDragOver={(event) => {
        if (event.operation.source?.type !== 'item') return;
        latest.current = move(latest.current, event);
        setItems(latest.current);
      }}
      onDragEnd={(event) => {
        dragging.current = false;
        if (event.canceled) {
          latest.current = snapshot.current;
          setItems(snapshot.current);
          return;
        }
        const source = event.operation.source;
        if (!source || source.type !== 'item') return;
        const id = String(source.id);
        const final = latest.current;
        const col = COLUMNS.find((c) => final[c.id].includes(id))?.id;
        if (!col) return;
        moveTask(id, col, final[col].indexOf(id));
      }}
    >
      <div className="grid h-full min-h-0 gap-4 overflow-x-auto pb-1 [grid-template-columns:repeat(3,minmax(280px,1fr))]">
        {COLUMNS.map((col, i) => (
          <KanbanColumn
            key={col.id}
            column={col}
            index={i}
            boardId={boardId}
            ids={items[col.id]}
            tasksById={tasksById}
            memberById={memberById}
            dragDisabled={dragDisabled}
            onOpen={onOpen}
            onDelete={onDelete}
          />
        ))}
      </div>
    </DragDropProvider>
  );
}
