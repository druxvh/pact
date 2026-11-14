import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { uid } from '@/lib/format';
import { syncAcrossTabs } from '@/lib/persist';
import { resolveInvite } from '@/store/members';
import { ME_ID } from '@/store/useUserStore';

export type ColumnId = 'todo' | 'in_progress' | 'done';
export const COLUMNS: ReadonlyArray<{ id: ColumnId; title: string }> = [
  { id: 'todo', title: 'To do' },
  { id: 'in_progress', title: 'In progress' },
  { id: 'done', title: 'Done' },
];
const COLUMN_IDS = COLUMNS.map((c) => c.id) as ColumnId[];
export const isColumnId = (v: unknown): v is ColumnId => COLUMN_IDS.includes(v as ColumnId);

export type Priority = 'none' | 'low' | 'medium' | 'high';

export type Board = {
  id: string;
  name: string;
  memberIds: string[];
  nextNumber: number;
  createdAt: string;
};

export type Task = {
  id: string;
  boardId: string;
  columnId: ColumnId;
  /** Per-board `#1`, `#2`… reference. */
  number: number;
  title: string;
  description: string;
  assigneeId: string | null;
  priority: Priority;
  /** Local calendar date, `YYYY-MM-DD`. */
  due: string | null;
  /** Fractional position within its column (see orderBetween). */
  order: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type TaskDraft = Partial<Pick<Task, 'title' | 'description' | 'assigneeId' | 'priority' | 'due' | 'columnId'>>;
export type BoardSnapshot = { board: Board; tasks: Task[] };

const now = () => new Date().toISOString();
export const DEFAULT_BOARD_ID = 'board-personal';
const STEP = 1000;

const defaultBoard = (): Board => ({
  id: DEFAULT_BOARD_ID,
  name: 'Personal',
  memberIds: [ME_ID],
  nextNumber: 1,
  createdAt: now(),
});

/**
 * Fractional indexing: a position strictly between two neighbours, so dropping a card
 * rewrites ONE task instead of re-numbering the whole column.
 */
export function orderBetween(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) return STEP;
  if (prev === undefined) return (next as number) - STEP;
  if (next === undefined) return prev + STEP;
  return (prev + next) / 2;
}

export function columnTasks(tasks: Task[], boardId: string, columnId: ColumnId): Task[] {
  return tasks.filter((t) => t.boardId === boardId && t.columnId === columnId).sort((a, b) => a.order - b.order);
}

type KanbanState = {
  boards: Board[];
  tasks: Task[];
  activeBoardId: string;

  setActiveBoard: (id: string) => void;
  createBoard: (name: string) => string;
  renameBoard: (id: string, name: string) => void;
  deleteBoard: (id: string) => BoardSnapshot | null;
  restoreBoard: (snapshot: BoardSnapshot) => void;
  inviteToBoard: (boardId: string, username: string) => { ok: boolean; msg: string; personId?: string };
  removeMember: (boardId: string, personId: string) => void;

  addTask: (boardId: string, columnId: ColumnId, title: string, extra?: TaskDraft) => string;
  updateTask: (id: string, patch: TaskDraft) => void;
  deleteTask: (id: string) => Task | null;
  restoreTask: (task: Task) => void;
  /** Place a task at `index` within `columnId` (index counts the destination column without the task). */
  moveTask: (id: string, columnId: ColumnId, index: number) => void;
};

export const useKanbanStore = create<KanbanState>()(
  persist(
    (set, get) => ({
      boards: [defaultBoard()],
      tasks: [],
      activeBoardId: DEFAULT_BOARD_ID,

      setActiveBoard: (activeBoardId) => set({ activeBoardId }),

      createBoard: (name) => {
        const id = uid('board');
        const board: Board = {
          id,
          name: name.trim() || `Board ${get().boards.length + 1}`,
          memberIds: [ME_ID],
          nextNumber: 1,
          createdAt: now(),
        };
        set((s) => ({ boards: [...s.boards, board], activeBoardId: id }));
        return id;
      },

      renameBoard: (id, name) => {
        const v = name.trim();
        if (!v) return;
        set((s) => ({ boards: s.boards.map((b) => (b.id === id ? { ...b, name: v } : b)) }));
      },

      deleteBoard: (id) => {
        const s = get();
        if (s.boards.length <= 1) return null;
        const board = s.boards.find((b) => b.id === id);
        if (!board) return null;
        const removed = s.tasks.filter((t) => t.boardId === id);
        const boards = s.boards.filter((b) => b.id !== id);
        set({
          boards,
          tasks: s.tasks.filter((t) => t.boardId !== id),
          activeBoardId: s.activeBoardId === id ? (boards[0]?.id ?? DEFAULT_BOARD_ID) : s.activeBoardId,
        });
        return { board, tasks: removed };
      },

      restoreBoard: ({ board, tasks }) =>
        set((s) =>
          s.boards.some((b) => b.id === board.id)
            ? s
            : { boards: [...s.boards, board], tasks: [...s.tasks, ...tasks], activeBoardId: board.id },
        ),

      inviteToBoard: (boardId, username) => {
        const board = get().boards.find((b) => b.id === boardId);
        if (!board) return { ok: false, msg: 'Board not found' };
        const r = resolveInvite(board.memberIds, username);
        if (!r.ok) return r;
        set((s) => ({
          boards: s.boards.map((b) => (b.id === boardId ? { ...b, memberIds: [...b.memberIds, r.person.id] } : b)),
        }));
        return { ok: true, msg: r.msg, personId: r.person.id };
      },

      removeMember: (boardId, personId) =>
        set((s) => ({
          boards: s.boards.map((b) =>
            b.id === boardId && personId !== ME_ID ? { ...b, memberIds: b.memberIds.filter((m) => m !== personId) } : b,
          ),
          tasks: s.tasks.map((t) => (t.boardId === boardId && t.assigneeId === personId ? { ...t, assigneeId: null } : t)),
        })),

      addTask: (boardId, columnId, title, extra) => {
        const s = get();
        const board = s.boards.find((b) => b.id === boardId);
        if (!board) return '';
        const id = uid('task');
        const stamp = now();
        const last = columnTasks(s.tasks, boardId, columnId).at(-1);
        const col = extra?.columnId ?? columnId;
        const task: Task = {
          id,
          boardId,
          columnId: col,
          number: board.nextNumber,
          title: title.trim(),
          description: extra?.description ?? '',
          assigneeId: extra?.assigneeId ?? null,
          priority: extra?.priority ?? 'none',
          due: extra?.due ?? null,
          order: orderBetween(last?.order, undefined),
          createdAt: stamp,
          updatedAt: stamp,
          completedAt: col === 'done' ? stamp : null,
        };
        set((st) => ({
          tasks: [...st.tasks, task],
          boards: st.boards.map((b) => (b.id === boardId ? { ...b, nextNumber: b.nextNumber + 1 } : b)),
        }));
        return id;
      },

      updateTask: (id, patch) =>
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id) return t;
            const next = { ...t, ...patch, updatedAt: now() };
            if (patch.columnId && patch.columnId !== t.columnId) {
              // changing status through the dialog: append to the end of the new column
              const last = columnTasks(s.tasks, t.boardId, patch.columnId).at(-1);
              next.order = orderBetween(last?.order, undefined);
              next.completedAt = patch.columnId === 'done' ? now() : null;
            }
            return next;
          }),
        })),

      deleteTask: (id) => {
        const task = get().tasks.find((t) => t.id === id);
        if (!task) return null;
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
        return task;
      },

      restoreTask: (task) => set((s) => (s.tasks.some((t) => t.id === task.id) ? s : { tasks: [...s.tasks, task] })),

      moveTask: (id, columnId, index) =>
        set((s) => {
          const task = s.tasks.find((t) => t.id === id);
          if (!task) return s;
          const dest = columnTasks(s.tasks, task.boardId, columnId).filter((t) => t.id !== id);
          const i = Math.max(0, Math.min(index, dest.length));
          const prev = dest[i - 1]?.order;
          const next = dest[i]?.order;
          const stamp = now();
          const completedAt =
            columnId === 'done' ? (task.columnId === 'done' ? task.completedAt : stamp) : null;

          // Neighbours too close for float precision → renumber this column once.
          if (prev !== undefined && next !== undefined && next - prev < 1e-6) {
            const ordered = [...dest.slice(0, i), task, ...dest.slice(i)];
            const orderById = new Map(ordered.map((t, k) => [t.id, (k + 1) * STEP]));
            return {
              tasks: s.tasks.map((t) =>
                orderById.has(t.id)
                  ? { ...t, order: orderById.get(t.id) as number, ...(t.id === id ? { columnId, completedAt, updatedAt: stamp } : null) }
                  : t,
              ),
            };
          }
          return {
            tasks: s.tasks.map((t) =>
              t.id === id ? { ...t, columnId, order: orderBetween(prev, next), completedAt, updatedAt: stamp } : t,
            ),
          };
        }),
    }),
    {
      name: 'pact-kanban',
      version: 2,
      migrate: (persisted) => {
        // v1: tasks were ordered by array position and had no priority/due/order.
        const p = (persisted ?? {}) as { boards?: Array<Partial<Board>>; tasks?: Array<Partial<Task> & { columnId?: string }>; activeBoardId?: string };
        const seen = new Map<string, number>();
        const tasks: Task[] = (p.tasks ?? []).map((t, i) => {
          const col: ColumnId = isColumnId(t.columnId) ? t.columnId : 'todo';
          const key = `${t.boardId}:${col}`;
          const k = (seen.get(key) ?? 0) + 1;
          seen.set(key, k);
          return {
            id: t.id ?? uid('task'),
            boardId: t.boardId ?? DEFAULT_BOARD_ID,
            columnId: col,
            number: t.number ?? i + 1,
            title: t.title ?? '',
            description: t.description ?? '',
            assigneeId: t.assigneeId ?? null,
            priority: t.priority ?? 'none',
            due: t.due ?? null,
            order: t.order ?? k * STEP,
            createdAt: t.createdAt ?? now(),
            updatedAt: t.updatedAt ?? t.createdAt ?? now(),
            completedAt: t.completedAt ?? (col === 'done' ? (t.createdAt ?? now()) : null),
          };
        });
        const boards: Board[] = (p.boards?.length ? p.boards : [defaultBoard()]).map((b) => ({
          id: b.id ?? uid('board'),
          name: b.name ?? 'Board',
          memberIds: b.memberIds ?? [ME_ID],
          createdAt: b.createdAt ?? now(),
          nextNumber:
            b.nextNumber ?? tasks.filter((t) => t.boardId === b.id).reduce((m, t) => Math.max(m, t.number), 0) + 1,
        }));
        return {
          boards,
          tasks,
          activeBoardId: boards.some((b) => b.id === p.activeBoardId) ? (p.activeBoardId as string) : (boards[0]?.id ?? DEFAULT_BOARD_ID),
        } as KanbanState;
      },
    },
  ),
);

syncAcrossTabs('pact-kanban', useKanbanStore);

// ── helpers shared by the UI ──────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
export const toDateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromDateKey = (key: string) => {
  const [y = 1970, m = 1, d = 1] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export type DueInfo = { label: string; tone: 'overdue' | 'soon' | 'later' };

/** "Today", "Tomorrow", "Fri", "Nov 20" + a tone for colouring. Done tasks are never "overdue". */
export function describeDue(due: string, done: boolean, today = new Date()): DueInfo {
  const day = fromDateKey(due);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((day.getTime() - t0.getTime()) / 86_400_000);
  let label: string;
  if (diff === 0) label = 'Today';
  else if (diff === 1) label = 'Tomorrow';
  else if (diff === -1) label = 'Yesterday';
  else if (diff > 1 && diff < 7) label = day.toLocaleDateString(undefined, { weekday: 'short' });
  else label = day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const tone: DueInfo['tone'] = done ? 'later' : diff < 0 ? 'overdue' : diff <= 1 ? 'soon' : 'later';
  return { label, tone };
}
