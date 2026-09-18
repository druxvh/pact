export type TaskStatus = 'todo' | 'in_progress' | 'done';

export type Task = {
  id: string;
  title: string;
  description?: string;
  columnId: string;
  createdAt: string;
};

export type KanbanColumn = {
  id: string;
  title: string;
  status: TaskStatus;
};
