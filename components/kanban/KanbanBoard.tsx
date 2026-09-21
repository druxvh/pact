import { useState, type FormEvent } from 'react';
import { Trash2, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useTaskStore } from '@/store/useTaskStore';

export function KanbanBoard() {
  const columns = useTaskStore((s) => s.columns);
  const tasks = useTaskStore((s) => s.tasks);
  const addTask = useTaskStore((s) => s.addTask);
  const moveTask = useTaskStore((s) => s.moveTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft.trim()) return;
    addTask('todo', draft);
    setDraft('');
  }

  return (
    <Card title="Kanban Board" className="min-h-[28rem]">
      <form className="mb-4 flex gap-2" onSubmit={handleAdd}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a task…"
          className="flex-1 rounded-sm border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-ring"
        />
        <Button type="submit" className="rounded-sm">Add</Button>
      </form>
      <div className="grid flex-1 gap-3 md:grid-cols-3">
        {columns.map((column) => (
          <div key={column.id} className="rounded-sm border border-border bg-muted/20 p-3">
            <h3 className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>{column.title}</span>
              <span className="rounded-sm border border-border bg-background px-2 py-0.5 text-[11px]">{tasks.filter((t) => t.columnId === column.id).length}</span>
            </h3>
            <motion.div layout className="space-y-2">
              <AnimatePresence initial={false}>
                {tasks
                  .filter((t) => t.columnId === column.id)
                  .map((task) => (
                    <motion.article
                      key={task.id}
                      layout
                      initial={{ opacity: 0, y: 6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="rounded-sm border border-border bg-card p-3 shadow-sm"
                    >
                      {editingId === task.id ? (
                        <div className="space-y-2">
                          <input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="w-full rounded-sm border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring"
                            autoFocus
                          />
                          <div className="flex gap-1.5">
                            <Button size="sm" className="rounded-sm" onClick={() => { if (editTitle.trim()) updateTask(task.id, { title: editTitle.trim() }); setEditingId(null); }}>Save</Button>
                            <Button size="sm" variant="ghost" className="rounded-sm" onClick={() => setEditingId(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-foreground">{task.title}</p>
                          {task.description && <p className="mt-1 text-xs text-muted-foreground">{task.description}</p>}
                          <div className="mt-3 flex flex-wrap items-center gap-1">
                            {columns.filter((c) => c.id !== column.id).map((target) => (
                              <Button key={target.id} variant="ghost" className="h-7 rounded-sm px-2 text-xs" onClick={() => moveTask(task.id, target.id)}>
                                → {target.title}
                              </Button>
                            ))}
                            <span className="flex-1" />
                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-sm text-muted-foreground" onClick={() => { setEditingId(task.id); setEditTitle(task.title); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-sm text-destructive hover:bg-destructive/10" onClick={() => deleteTask(task.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </>
                      )}
                    </motion.article>
                  ))}
              </AnimatePresence>
              {tasks.filter((t) => t.columnId === column.id).length === 0 && (
                <p className="rounded-sm border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Drop tasks here</p>
              )}
            </motion.div>
          </div>
        ))}
      </div>
    </Card>
  );
}
