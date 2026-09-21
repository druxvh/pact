import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { KanbanColumn, Task } from '@/types/task';

type TaskState = {
  columns: KanbanColumn[];
  tasks: Task[];
  addTask: (columnId: string, title: string) => void;
  moveTask: (taskId: string, columnId: string) => void;
  deleteTask: (id: string) => void;
  updateTask: (id: string, patch: Partial<Task>) => void;
};

const defaultColumns: KanbanColumn[] = [
  { id: 'todo', title: 'To Do', status: 'todo' },
  { id: 'in_progress', title: 'In Progress', status: 'in_progress' },
  { id: 'done', title: 'Done', status: 'done' },
];

const now = () => new Date().toISOString();

export const useTaskStore = create<TaskState>()(
  persist(
    (set) => ({
      columns: defaultColumns,
      tasks: [
        { id: 'task-1', title: 'Sketch the new-tab grid', description: 'Sidebar shell + top bar + sections', columnId: 'todo', createdAt: now() },
        { id: 'task-2', title: 'Wire Supabase presence', description: 'Mock sync for MVP, then Supabase realtime', columnId: 'in_progress', createdAt: now() },
        { id: 'task-3', title: 'Black theme', description: 'shipped ✓', columnId: 'done', createdAt: now() },
        { id: 'task-4', title: 'Build utility tools', description: 'x→y converters', columnId: 'todo', createdAt: now() },
      ],
      addTask: (columnId, title) =>
        set((state) => ({
          tasks: [
            ...state.tasks,
            { id: crypto.randomUUID(), title: title.trim(), columnId, createdAt: now() },
          ],
        })),
      moveTask: (taskId, columnId) =>
        set((state) => ({
          tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, columnId } : task)),
        })),
      deleteTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
      updateTask: (id, patch) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
    }),
    { name: 'pact-tasks' },
  ),
);
