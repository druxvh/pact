import { Check, ListTodo } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Badge, Input } from '@/components/ui';
import { dateKey, type TodayBucket, todayTasks } from '@/features/home/widgets/today';
import { OpenLink, WidgetCard, WidgetEmpty } from '@/features/home/widgets/WidgetCard';
import { useKanbanStore } from '@/features/kanban/store';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';

const BUCKET_LABEL: Record<TodayBucket, { text: string; tone: 'destructive' | 'brand' | 'neutral' } | null> = {
  overdue: { text: 'Overdue', tone: 'destructive' },
  today: { text: 'Today', tone: 'brand' },
  progress: { text: 'In progress', tone: 'neutral' },
  upnext: null,
};

/** Overdue, due-today and in-progress tasks from the board, with a one-line “add” and tick-to-finish. */
export function TodayWidget() {
  const tasks = useKanbanStore((s) => s.tasks);
  const updateTask = useKanbanStore((s) => s.updateTask);
  const addTask = useKanbanStore((s) => s.addTask);
  const [draft, setDraft] = useState('');

  const today = dateKey();
  const { items, open } = todayTasks(tasks, today, 5);

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    const board = useKanbanStore.getState().activeBoardId;
    if (addTask(board, 'todo', title, { due: today })) {
      setDraft('');
      notify.success('Added to today', title);
    }
  };

  return (
    <WidgetCard icon={ListTodo} title="Today" action={open > 0 ? <OpenLink to="kanban" label={`All ${open}`} /> : undefined}>
      {items.length === 0 ? (
        <WidgetEmpty>Nothing on your plate. Add something below, or enjoy the quiet.</WidgetEmpty>
      ) : (
        <ul className="-mx-1 space-y-0.5">
          <AnimatePresence initial={false}>
            {items.map(({ task, bucket }) => {
              const tag = BUCKET_LABEL[bucket];
              return (
                <motion.li
                  key={task.id}
                  layout="position"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="flex items-center gap-2 overflow-hidden rounded-md px-1 py-1 hover:bg-accent/60"
                >
                  <button
                    type="button"
                    aria-label={`Mark “${task.title}” as done`}
                    onClick={() => updateTask(task.id, { columnId: 'done' })}
                    className={cn(
                      'group relative grid size-5 shrink-0 place-items-center rounded-md border border-input transition-colors',
                      'hover:border-brand hover:bg-brand-soft',
                      // the box stays 20px; the tap target grows to 32px
                      "after:absolute after:-inset-1.5 after:content-['']",
                    )}
                  >
                    <Check className="size-3 text-brand-text opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-[13px]">{task.title}</span>
                  {tag && <Badge tone={tag.tone}>{tag.text}</Badge>}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
      <div className="mt-auto pt-3">
        <Input
          aria-label="Add a task for today"
          placeholder="Add a task for today…"
          value={draft}
          maxLength={120}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
      </div>
    </WidgetCard>
  );
}
