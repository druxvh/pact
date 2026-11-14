import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useUserStore } from '@/store/useUserStore';

export type Board = {
  id: string;
  name: string;
  memberIds: string[];
  createdAt: string;
};

export type KanbanTask = {
  id: string;
  boardId: string;
  columnId: string; // 'todo' | 'in_progress' | 'done'
  number: number; // #1, #2
  title: string;
  description?: string;
  assigneeId?: string | null;
  createdAt: string;
};

export const DEFAULT_COLUMNS = [
  { id: 'todo', title: 'To Do' },
  { id: 'in_progress', title: 'In Progress' },
  { id: 'done', title: 'Done' },
] as const;

type KanbanState = {
  boards: Board[];
  activeBoardId: string;
  tasks: KanbanTask[];
  // actions
  setActiveBoard: (id: string) => void;
  createBoard: (name: string, memberIds?: string[]) => string;
  deleteBoard: (id: string) => void;
  inviteToBoard: (boardId: string, username: string) => { ok: boolean; msg: string };
  removeMember: (boardId: string, memberId: string) => void;
  addTask: (boardId: string, columnId: string, title: string) => void;
  updateTask: (id: string, patch: Partial<KanbanTask>) => void;
  deleteTask: (id: string) => void;
  assignTask: (taskId: string, assigneeId: string | null) => void;
  moveTask: (activeId: string, overId: string | null, overColumn: string | null) => void;
  reorderWithinBoard: (boardId: string, columnId: string, fromIndex: number, toIndex: number) => void;
};

const now = () => new Date().toISOString();

const seedBoards: Board[] = [
  { id: 'board-1', name: 'Personal', memberIds: ['local-user'], createdAt: now() },
  { id: 'board-2', name: 'design jam', memberIds: ['local-user', 'alex', 'jordan'], createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString() },
  { id: 'board-3', name: 'pact launch', memberIds: ['local-user', 'sam', 'riley'], createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString() },
];

const seedTasks: KanbanTask[] = [
  { id: 't1', boardId: 'board-1', columnId: 'todo', number: 1, title: 'Sketch the new-tab grid', description: 'Sidebar shell + top bar + sections', assigneeId: 'local-user', createdAt: now() },
  { id: 't2', boardId: 'board-1', columnId: 'todo', number: 2, title: 'Build utility tools', description: 'x→y converters', assigneeId: null, createdAt: now() },
  { id: 't3', boardId: 'board-1', columnId: 'in_progress', number: 3, title: 'Wire Supabase presence', description: 'Mock sync for MVP', assigneeId: 'local-user', createdAt: now() },
  { id: 't4', boardId: 'board-1', columnId: 'done', number: 4, title: 'Black theme', description: 'shipped ✓', assigneeId: null, createdAt: now() },
  { id: 't5', boardId: 'board-2', columnId: 'todo', number: 1, title: 'Onboarding copy', description: 'Username + bio flow', assigneeId: 'alex', createdAt: now() },
  { id: 't6', boardId: 'board-2', columnId: 'in_progress', number: 2, title: 'Review pact spaces', description: 'Invite by username', assigneeId: 'jordan', createdAt: now() },
  { id: 't7', boardId: 'board-2', columnId: 'done', number: 3, title: 'Home minimal', description: 'Search + most used', assigneeId: null, createdAt: now() },
  { id: 't8', boardId: 'board-3', columnId: 'todo', number: 1, title: 'Fix notifications', description: 'Popover + unread', assigneeId: 'sam', createdAt: now() },
];

export const useKanbanStore = create<KanbanState>()(
  persist(
    (set, get) => ({
      boards: seedBoards,
      activeBoardId: 'board-1',
      tasks: seedTasks,

      setActiveBoard: (activeBoardId) => set({ activeBoardId }),

      createBoard: (name, memberIds = ['local-user']) => {
        const id = `board-${crypto.randomUUID().slice(0, 8)}`;
        const board: Board = { id, name: name.trim() || `Board ${get().boards.length + 1}`, memberIds, createdAt: now() };
        set((s) => ({ boards: [...s.boards, board], activeBoardId: id }));
        return id;
      },

      deleteBoard: (id) =>
        set((s) => {
          const boards = s.boards.filter((b) => b.id !== id);
          const activeBoardId = s.activeBoardId === id ? (boards[0]?.id ?? s.boards[0]?.id ?? id) : s.activeBoardId;
          const tasks = s.tasks.filter((t) => t.boardId !== id);
          return { boards: boards.length ? boards : s.boards, tasks, activeBoardId: activeBoardId ?? s.activeBoardId };
        }),

      inviteToBoard: (boardId, username) => {
        const clean = username.replace(/^@/, '').trim().toLowerCase();
        if (!clean) return { ok: false, msg: 'Enter username' };
        const teammates = useUserStore.getState().teammates;
        const found = teammates.find((t) => t.username.toLowerCase() === clean);
        if (!found) return { ok: false, msg: `No user @${clean} (try alex/jordan/sam/riley)` };
        let ok = false;
        let msg = `Already in board`;
        set((s) => {
          const boards = s.boards.map((b) => {
            if (b.id !== boardId) return b;
            if (b.memberIds.includes(found.id)) return b;
            ok = true;
            msg = `Added @${found.username}`;
            return { ...b, memberIds: [...b.memberIds, found.id] };
          });
          return { boards };
        });
        return { ok, msg };
      },

      removeMember: (boardId, memberId) =>
        set((s) => ({
          boards: s.boards.map((b) => (b.id === boardId ? { ...b, memberIds: b.memberIds.filter((id) => id !== memberId) } : b)),
        })),

      addTask: (boardId, columnId, title) =>
        set((s) => {
          const boardTasks = s.tasks.filter((t) => t.boardId === boardId);
          const maxNum = boardTasks.reduce((m, t) => Math.max(m, t.number), 0);
          const task: KanbanTask = {
            id: crypto.randomUUID(),
            boardId,
            columnId,
            number: maxNum + 1,
            title: title.trim(),
            assigneeId: null,
            createdAt: now(),
          };
          return { tasks: [...s.tasks, task] };
        }),

      updateTask: (id, patch) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),

      deleteTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

      assignTask: (taskId, assigneeId) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, assigneeId } : t)) })),

      // dnd-kit: move active task over another task or column
      moveTask: (activeId, overId, overColumn) =>
        set((s) => {
          const active = s.tasks.find((t) => t.id === activeId);
          if (!active) return s;
          // if over a column (empty), move to column
          if (overColumn && !overId) {
            return { tasks: s.tasks.map((t) => (t.id === activeId ? { ...t, columnId: overColumn } : t)) };
          }
          const over = s.tasks.find((t) => t.id === overId);
          if (!over) {
            // fallback to column
            if (overColumn) return { tasks: s.tasks.map((t) => (t.id === activeId ? { ...t, columnId: overColumn } : t)) };
            return s;
          }
          // if different boards — don't move
          if (active.boardId !== over.boardId) return s;

          // reorder: move active to over's position and column
          const activeIndex = s.tasks.findIndex((t) => t.id === activeId);
          const overIndex = s.tasks.findIndex((t) => t.id === overId);
          if (activeIndex === -1 || overIndex === -1) return s;

          // if same board, we will update column and Order by splicing
          // For minimal, just change column, and splice array to overIndex
          const newTasks = [...s.tasks];
          const [moved] = newTasks.splice(activeIndex, 1);
          if (!moved) return s;
          moved.columnId = over.columnId;
          // insert before over item (adjust if active before over)
          const insertAt = activeIndex < overIndex ? overIndex - 1 : overIndex;
          newTasks.splice(insertAt, 0, moved);
          return { tasks: newTasks };
        }),

      reorderWithinBoard: (boardId, columnId, fromIndex, toIndex) =>
        set((s) => {
          const columnTasks = s.tasks.filter((t) => t.boardId === boardId && t.columnId === columnId);
          const other = s.tasks.filter((t) => !(t.boardId === boardId && t.columnId === columnId));
          const reordered = [...columnTasks];
          const [moved] = reordered.splice(fromIndex, 1);
          if (!moved) return s;
          reordered.splice(toIndex, 0, moved);
          return { tasks: [...other, ...reordered].sort((a, b) => a.number - b.number) };
        }),
    }),
    {
      name: 'pact-kanban',
      version: 1,
    },
  ),
);
