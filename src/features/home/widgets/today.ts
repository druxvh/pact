import type { Priority, Task } from '@/features/kanban/store';

export type TodayBucket = 'overdue' | 'today' | 'progress' | 'upnext';
export type TodayTask = { task: Task; bucket: TodayBucket };

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2, none: 3 };
const BUCKET_RANK: Record<TodayBucket, number> = { overdue: 0, today: 1, progress: 2, upnext: 3 };

/** Local calendar date as `YYYY-MM-DD` — the same shape as `Task.due`. */
export const dateKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function bucketOf(task: Task, today: string): TodayBucket {
  if (task.due && task.due < today) return 'overdue';
  if (task.due === today) return 'today';
  return task.columnId === 'in_progress' ? 'progress' : 'upnext';
}

/**
 * What to do now: overdue first, then due today, then what's in progress, then the rest of the to-do list; ties go to
 * higher priority, then the order on the board. Finished tasks never appear. `open` counts every unfinished task.
 */
export function todayTasks(tasks: readonly Task[], today: string, limit = 5): { items: TodayTask[]; open: number } {
  const open = tasks.filter((t) => t.columnId !== 'done');
  const items = open
    .map<TodayTask>((task) => ({ task, bucket: bucketOf(task, today) }))
    .sort(
      (a, b) =>
        BUCKET_RANK[a.bucket] - BUCKET_RANK[b.bucket] ||
        PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority] ||
        (a.task.due ?? '9999').localeCompare(b.task.due ?? '9999') ||
        a.task.order - b.task.order,
    )
    .slice(0, limit);
  return { items, open: open.length };
}
