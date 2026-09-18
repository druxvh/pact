import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useTaskStore } from '@/store/useTaskStore';

export function KanbanBoard() {
  const columns = useTaskStore((state) => state.columns);
  const tasks = useTaskStore((state) => state.tasks);
  const addTask = useTaskStore((state) => state.addTask);
  const moveTask = useTaskStore((state) => state.moveTask);
  const [draft, setDraft] = useState('');

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim()) return;
    addTask('todo', draft);
    setDraft('');
  }

  return (
    <Card title="Kanban Board" className="min-h-[28rem]">
      <form className="mb-4 flex gap-2" onSubmit={handleAdd}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a task…"
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none ring-sky-500/40 focus:ring-2"
        />
        <Button type="submit">Add</Button>
      </form>
      <div className="grid flex-1 gap-3 md:grid-cols-3">
        {columns.map((column) => (
          <div
            key={column.id}
            className="rounded-xl border border-slate-800 bg-slate-950/70 p-3"
          >
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              {column.title}
            </h3>
            <div className="space-y-2">
              {tasks
                .filter((task) => task.columnId === column.id)
                .map((task) => (
                  <article
                    key={task.id}
                    className="rounded-lg border border-slate-800 bg-slate-900 p-3"
                  >
                    <p className="text-sm font-medium">{task.title}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {columns
                        .filter((item) => item.id !== column.id)
                        .map((target) => (
                          <Button
                            key={target.id}
                            variant="ghost"
                            className="h-7 px-2 text-xs text-slate-400"
                            onClick={() => moveTask(task.id, target.id)}
                          >
                            {target.title}
                          </Button>
                        ))}
                    </div>
                  </article>
                ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
