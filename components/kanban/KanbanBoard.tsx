import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
} from '@dnd-kit/core';
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, GripVertical, Trash2, Pencil, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useKanbanStore, DEFAULT_COLUMNS } from '@/store/useKanbanStore';
import { useUserStore } from '@/store/useUserStore';
import { cn } from '@/lib/cn';

function TaskCard({
  task,
  boardMemberIds,
  isDragging,
}: {
  task: { id: string; number: number; title: string; description?: string; assigneeId?: string | null; columnId: string };
  boardMemberIds: string[];
  isDragging?: boolean;
}) {
  const updateTask = useKanbanStore((s) => s.updateTask);
  const deleteTask = useKanbanStore((s) => s.deleteTask);
  const assignTask = useKanbanStore((s) => s.assignTask);
  const teammates = useUserStore((s) => s.teammates);
  const currentUser = useUserStore((s) => s.currentUser);
  const allUsers = useMemo(() => [currentUser!, ...teammates].filter(Boolean), [currentUser, teammates]);
  const boardMembers = useMemo(() => allUsers.filter((u) => boardMemberIds.includes(u.id)), [allUsers, boardMemberIds]);
  const assignee = allUsers.find((u) => u.id === task.assigneeId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [showAssign, setShowAssign] = useState(false);

  return (
    <div
      className={cn(
        'group relative rounded-sm bg-card p-3 shadow-sm transition-all',
        isDragging ? 'shadow-lg ring-1 ring-accent/30' : 'hover:shadow-md hover:border-accent/20',
        'border border-transparent dark:border-border/60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="rounded-sm bg-accent/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-accent">#{task.number}</span>
          {!editing && <GripVertical className="h-3 w-3 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={() => setEditing(true)} className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => deleteTask(task.id)} className="rounded-sm p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus className="w-full rounded-sm border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring" />
          <div className="flex gap-1.5">
            <Button size="sm" className="h-7 rounded-sm px-2.5" onClick={() => { if (draft.trim()) updateTask(task.id, { title: draft.trim() }); setEditing(false); }}>Save</Button>
            <Button size="sm" variant="ghost" className="h-7 rounded-sm" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm font-medium leading-5 text-foreground">{task.title}</p>
          {task.description && <p className="mt-1 line-clamp-2 text-xs leading-4 text-muted-foreground">{task.description}</p>}
          <div className="mt-3 flex items-center justify-between">
            <div className="relative">
              <button
                onClick={() => setShowAssign((v) => !v)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs transition-colors',
                  assignee ? 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/20' : 'border-dashed border-border bg-muted/40 text-muted-foreground hover:border-accent/40 hover:text-accent-foreground',
                )}
              >
                {assignee ? (
                  <>
                    <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-accent text-[10px] font-medium text-accent-foreground">
                      {assignee.displayName.slice(0, 1).toUpperCase()}
                    </span>
                    {assignee.username}
                  </>
                ) : (
                  <>
                    <UserPlus className="h-3 w-3" /> Assign
                  </>
                )}
              </button>
              <AnimatePresence>
                {showAssign && (
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.14 }}
                    className="absolute left-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-sm border border-border bg-popover shadow-lg"
                  >
                    <div className="p-1">
                      <button onClick={() => { assignTask(task.id, null); setShowAssign(false); }} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent">
                        <span className="flex h-6 w-6 items-center justify-center rounded-sm border border-dashed border-border text-muted-foreground">—</span> Unassigned
                      </button>
                      {boardMembers.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => { assignTask(task.id, m.id); setShowAssign(false); }}
                          className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent', task.assigneeId === m.id && 'bg-accent')}
                        >
                          <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-muted text-xs font-medium text-foreground">{m.displayName.slice(0, 1)}</span>
                          <span className="flex-1 truncate">{m.displayName} <span className="text-muted-foreground">@{m.username}</span></span>
                          {task.assigneeId === m.id && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            {assignee && (
              <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-muted text-xs font-medium text-foreground" title={assignee.displayName}>
                {assignee.displayName.slice(0, 1)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SortableTask({ task, boardMemberIds }: { task: any; boardMemberIds: string[] }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { columnId: task.columnId, boardId: task.boardId } });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} boardMemberIds={boardMemberIds} isDragging={isDragging} />
    </div>
  );
}

function Column({
  column,
  tasks,
  boardId,
  boardMemberIds,
}: {
  column: { id: string; title: string };
  tasks: any[];
  boardId: string;
  boardMemberIds: string[];
}) {
  const addTask = useKanbanStore((s) => s.addTask);
  const [draft, setDraft] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: column.id, data: { columnId: column.id } });

  return (
    <div ref={setNodeRef} className={`flex min-w-[280px] max-w-[340px] flex-1 flex-col rounded-sm p-2.5 transition-colors ${isOver ? 'bg-accent/40' : 'bg-muted/30'}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {column.title}
          <span className="rounded-sm bg-accent/10 px-1.5 py-0.5 text-[11px] font-mono font-medium text-accent">{tasks.length}</span>
        </h3>
        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-sm text-muted-foreground" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-3 overflow-hidden">
            <div className="flex gap-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Task title…"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && draft.trim()) {
                    addTask(boardId, column.id, draft);
                    setDraft('');
                  }
                  if (e.key === 'Escape') setShowAdd(false);
                }}
                className="flex-1 rounded-sm border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-ring"
              />
              <Button size="sm" className="h-8 rounded-sm" onClick={() => { if (draft.trim()) { addTask(boardId, column.id, draft); setDraft(''); } }}>
                Add
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2">
          {tasks.map((task) => (
            <SortableTask key={task.id} task={task} boardMemberIds={boardMemberIds} />
          ))}
          {tasks.length === 0 && (
            <div className="flex flex-1 items-center justify-center rounded-sm border border-dashed border-border/60 bg-transparent p-6 text-center">
              <p className="text-xs text-muted-foreground">No tasks — drop here or add</p>
            </div>
          )}
          {/* inline add at bottom */}
          {!showAdd && (
            <button onClick={() => setShowAdd(true)} className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-sm border border-dashed border-border/60 bg-transparent py-2 text-xs text-muted-foreground transition-colors hover:border-ring hover:text-foreground">
              <Plus className="h-3 w-3" /> Add task
            </button>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export function KanbanBoard() {
  const boards = useKanbanStore((s) => s.boards);
  const activeBoardId = useKanbanStore((s) => s.activeBoardId);
  const tasks = useKanbanStore((s) => s.tasks);
  const moveTask = useKanbanStore((s) => s.moveTask);
  const activeBoard = boards.find((b) => b.id === activeBoardId) ?? boards[0];
  const [activeId, setActiveId] = useState<string | null>(null);

  const boardTasks = useMemo(() => tasks.filter((t) => t.boardId === activeBoard?.id), [tasks, activeBoard]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  const handleDragStart = (e: DragStartEvent) => setActiveId(e.active.id as string);
  const handleDragOver = (_e: DragOverEvent) => {};
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;
    if (active.id === over.id) return;
    const overColumn = over.data.current?.columnId ?? (DEFAULT_COLUMNS as any).find((c: any) => c.id === over.id)?.id ?? null;
    // if over is a column container, over.id is column id
    const isOverColumn = (DEFAULT_COLUMNS as any).some((c: any) => c.id === over.id);
    const targetColumn = isOverColumn ? (over.id as string) : over.data.current?.columnId ?? null;
    moveTask(active.id as string, isOverColumn ? null : (over.id as string), targetColumn ?? overColumn);
  };

  if (!activeBoard) return <div className="p-6 text-sm text-muted-foreground">No board</div>;

  return (
    <div className="w-full">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
        <div className="flex w-full gap-3 overflow-x-auto pb-4">
          {DEFAULT_COLUMNS.map((col) => {
            const colTasks = boardTasks.filter((t) => t.columnId === col.id);
            return <Column key={col.id} column={col} tasks={colTasks} boardId={activeBoard.id} boardMemberIds={activeBoard.memberIds} />;
          })}
        </div>
        <DragOverlay>
          {activeTask ? (
            <div className="rotate-[1deg] scale-[1.02]">
              <TaskCard task={activeTask} boardMemberIds={activeBoard.memberIds} isDragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
