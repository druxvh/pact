import { Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Avatar,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  Label,
  Segmented,
  Select,
  Textarea,
} from '@/components/ui';
import { COLUMNS, type ColumnId, type Priority, type Task, toDateKey, useKanbanStore } from '@/features/kanban/store';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/toast';
import type { Person } from '@/types/user';

export type TaskDialogTarget = { kind: 'edit'; id: string } | { kind: 'create'; boardId: string; columnId: ColumnId } | null;

type Props = {
  target: TaskDialogTarget;
  members: Person[];
  onClose: () => void;
  onDelete: (task: Task) => void;
};

const UNASSIGNED = '__none__';

const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toDateKey(d);
};

export function TaskDialog({ target, members, onClose, onDelete }: Props) {
  const task = useKanbanStore((s) => (target?.kind === 'edit' ? s.tasks.find((t) => t.id === target.id) : undefined));
  const addTask = useKanbanStore((s) => s.addTask);
  const updateTask = useKanbanStore((s) => s.updateTask);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('none');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);
  const [column, setColumn] = useState<ColumnId>('todo');
  const [error, setError] = useState<string | null>(null);

  // Load fields whenever a different task / mode is opened.
  const targetKey = target ? (target.kind === 'edit' ? `edit:${target.id}` : `create:${target.columnId}`) : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the target changes
  useEffect(() => {
    if (!target) return;
    setError(null);
    if (target.kind === 'edit' && task) {
      setTitle(task.title);
      setDescription(task.description);
      setPriority(task.priority);
      setDue(task.due ?? '');
      setAssignee(task.assigneeId ?? UNASSIGNED);
      setColumn(task.columnId);
    } else if (target.kind === 'create') {
      setTitle('');
      setDescription('');
      setPriority('none');
      setDue('');
      setAssignee(UNASSIGNED);
      setColumn(target.columnId);
    }
  }, [targetKey]);

  const save = () => {
    if (!target) return;
    const t = title.trim();
    if (!t) {
      setError('Give the task a title');
      return;
    }
    const draft = {
      description: description.trim(),
      priority,
      due: due || null,
      assigneeId: assignee === UNASSIGNED ? null : assignee,
      columnId: column,
    };
    if (target.kind === 'edit') {
      updateTask(target.id, { title: t, ...draft });
      notify.success('Task updated');
    } else {
      addTask(target.boardId, column, t, draft);
      notify.success('Task created');
    }
    onClose();
  };

  const isEdit = target?.kind === 'edit';

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              save();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{isEdit && task ? `Task #${task.number}` : 'New task'}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                autoFocus
                value={title}
                maxLength={140}
                placeholder="What needs to happen?"
                aria-invalid={error ? true : undefined}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setError(null);
                }}
              />
              {error && <p className="mt-1.5 text-xs text-destructive-text">{error}</p>}
            </div>

            <div>
              <Label htmlFor="task-desc">Description</Label>
              <Textarea
                id="task-desc"
                rows={3}
                value={description}
                maxLength={2000}
                placeholder="Add context, links, or acceptance criteria…"
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Status</Label>
                <Select<ColumnId>
                  aria-label="Status"
                  value={column}
                  onValueChange={setColumn}
                  options={COLUMNS.map((c) => ({ value: c.id, label: c.title }))}
                />
              </div>
              <div>
                <Label>Assignee</Label>
                <Select
                  aria-label="Assignee"
                  value={assignee}
                  onValueChange={setAssignee}
                  options={[{ value: UNASSIGNED, label: 'Unassigned' }, ...members.map((m) => ({ value: m.id, label: m.displayName }))]}
                />
              </div>
            </div>

            <div>
              <Label>Priority</Label>
              <Segmented<Priority>
                aria-label="Priority"
                fullWidth
                value={priority}
                onValueChange={setPriority}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                ]}
              />
            </div>

            <div>
              <Label htmlFor="task-due">Due date</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-40" />
                <Button size="sm" variant="outline" onClick={() => setDue(addDays(0))}>
                  Today
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDue(addDays(1))}>
                  Tomorrow
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDue(addDays(7))}>
                  Next week
                </Button>
                {/* Always rendered (just invisible when empty) so the row never reflows. */}
                <IconButton label="Clear due date" size="icon-sm" onClick={() => setDue('')} className={cn(!due && 'invisible')} tabIndex={due ? 0 : -1}>
                  <X />
                </IconButton>
              </div>
            </div>

            {isEdit && task && assignee !== UNASSIGNED && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Avatar name={members.find((m) => m.id === assignee)?.displayName ?? '?'} size="xs" />
                Assigned to @{members.find((m) => m.id === assignee)?.username}
              </p>
            )}
          </DialogBody>
          <DialogFooter className="justify-between">
            {isEdit && task ? (
              <Button
                variant="danger"
                onClick={() => {
                  onClose();
                  onDelete(task);
                }}
              >
                <Trash2 /> Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                {isEdit ? 'Save changes' : 'Create task'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
