import { create } from 'zustand';
import type { KanbanColumn, Task } from '@/types/task';

type TaskState = {
  columns: KanbanColumn[];
  tasks: Task[];
  addTask: (columnId: string, title: string) => void;
  moveTask: (taskId: string, columnId: string) => void;
};

const defaultColumns: KanbanColumn[] = [
  { id: 'todo', title: 'To Do', status: 'todo' },
  { id: 'in_progress', title: 'In Progress', status: 'in_progress' },
  { id: 'done', title: 'Done', status: 'done' },
];

const now = () => new Date().toISOString();

export const useTaskStore = create<TaskState>((set) => ({
  columns: defaultColumns,
  tasks: [
    {
      id: 'task-1',
      title: 'Sketch the new-tab grid',
      columnId: 'todo',
      createdAt: now(),
    },
    {
      id: 'task-2',
      title: 'Wire Supabase presence',
      columnId: 'in_progress',
      createdAt: now(),
    },
  ],
  addTask: (columnId, title) =>
    set((state) => ({
      tasks: [
        ...state.tasks,
        {
          id: crypto.randomUUID(),
          title: title.trim(),
          columnId,
          createdAt: now(),
        },
      ],
    })),
  moveTask: (taskId, columnId) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId ? { ...task, columnId } : task,
      ),
    })),
}));
