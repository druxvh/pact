import { Columns3, Plus, Search, X } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { GroupBar, type GroupItem } from '@/components/GroupBar';
import { InviteDialog } from '@/components/InviteDialog';
import { Button, confirm, InputGroup, Kbd, PageHeader, promptText, Segmented } from '@/components/ui';
import { Board } from '@/features/kanban/Board';
import { type Task, useKanbanStore } from '@/features/kanban/store';
import { TaskDialog, type TaskDialogTarget } from '@/features/kanban/TaskDialog';
import { useHotkeys } from '@/lib/hotkeys';
import { spring } from '@/lib/motion';
import { notify } from '@/lib/toast';
import { membersOf } from '@/store/members';
import { useUiStore } from '@/store/useUiStore';
import { ME_ID, useUserStore } from '@/store/useUserStore';

type Scope = 'all' | 'mine';

export function KanbanView() {
  const boards = useKanbanStore((s) => s.boards);
  const tasks = useKanbanStore((s) => s.tasks);
  const activeBoardId = useKanbanStore((s) => s.activeBoardId);
  const setActiveBoard = useKanbanStore((s) => s.setActiveBoard);
  const createBoard = useKanbanStore((s) => s.createBoard);
  const renameBoard = useKanbanStore((s) => s.renameBoard);
  const deleteBoard = useKanbanStore((s) => s.deleteBoard);
  const restoreBoard = useKanbanStore((s) => s.restoreBoard);
  const inviteToBoard = useKanbanStore((s) => s.inviteToBoard);
  const removeMember = useKanbanStore((s) => s.removeMember);
  const deleteTask = useKanbanStore((s) => s.deleteTask);
  const restoreTask = useKanbanStore((s) => s.restoreTask);
  const teammates = useUserStore((s) => s.teammates);
  const currentUser = useUserStore((s) => s.currentUser);

  const pendingTaskId = useUiStore((s) => s.pendingTaskId);
  const pendingNewTask = useUiStore((s) => s.pendingNewTask);
  const [dialog, setDialog] = useState<TaskDialogTarget>(null);
  const [inviteFor, setInviteFor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');

  const board = boards.find((b) => b.id === activeBoardId) ?? boards[0];
  const boardTasks = useMemo(() => tasks.filter((t) => t.boardId === board?.id), [tasks, board?.id]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return boardTasks.filter(
      (t) =>
        (scope === 'all' || t.assigneeId === ME_ID) &&
        (!q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || `#${t.number}` === q),
    );
  }, [boardTasks, query, scope]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: teammates/currentUser re-resolve member profiles
  const members = useMemo(() => (board ? membersOf(board.memberIds) : []), [board, teammates, currentUser]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: member names come from the user store; re-resolve when profiles change
  const groups = useMemo<GroupItem[]>(
    () =>
      boards.map((b) => ({
        id: b.id,
        name: b.name,
        count: tasks.filter((t) => t.boardId === b.id).length,
        members: membersOf(b.memberIds).map((p) => ({ id: p.id, name: p.displayName })),
      })),
    [boards, tasks, teammates, currentUser],
  );

  // Intents from the command palette ("open task…" / "New task").
  useEffect(() => {
    const ui = useUiStore.getState();
    if (pendingTaskId) {
      setDialog({ kind: 'edit', id: pendingTaskId });
      ui.setPendingTaskId(null);
    } else if (pendingNewTask && board) {
      setDialog({ kind: 'create', boardId: board.id, columnId: 'todo' });
      ui.setPendingNewTask(false);
    }
  }, [pendingTaskId, pendingNewTask, board]);

  useHotkeys([
    {
      keys: 'n',
      enabled: dialog === null && inviteFor === null && Boolean(board),
      handler: () => board && setDialog({ kind: 'create', boardId: board.id, columnId: 'todo' }),
    },
  ]);

  if (!board) return null;

  const done = boardTasks.filter((t) => t.columnId === 'done').length;
  const pct = boardTasks.length ? Math.round((done / boardTasks.length) * 100) : 0;
  const filtering = query.trim() !== '' || scope !== 'all';
  const invitingBoard = boards.find((b) => b.id === inviteFor);

  const removeTask = (task: Task) => {
    const removed = deleteTask(task.id);
    if (removed) notify.undo(`Deleted “${removed.title}”`, () => restoreTask(removed));
  };

  const onCreateBoard = async () => {
    const name = await promptText({ title: 'New board', label: 'Board name', placeholder: 'e.g. Sprint 12', confirmLabel: 'Create' });
    if (name) createBoard(name);
  };

  const onRenameBoard = async (id: string) => {
    const b = boards.find((x) => x.id === id);
    if (!b) return;
    const name = await promptText({ title: 'Rename board', label: 'Board name', initial: b.name, confirmLabel: 'Rename' });
    if (name) renameBoard(id, name);
  };

  const onDeleteBoard = async (id: string) => {
    const b = boards.find((x) => x.id === id);
    if (!b) return;
    const count = tasks.filter((t) => t.boardId === id).length;
    const ok = await confirm({
      title: `Delete “${b.name}”?`,
      description: count ? `Its ${count} ${count === 1 ? 'task' : 'tasks'} will be deleted too. You can undo right after.` : 'This board is empty.',
      confirmLabel: 'Delete board',
      destructive: true,
    });
    if (!ok) return;
    const snapshot = deleteBoard(id);
    if (snapshot) notify.undo(`Deleted “${b.name}”`, () => restoreBoard(snapshot));
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 md:p-6">
      <PageHeader
        icon={Columns3}
        title="Kanban"
        description={boardTasks.length ? `${done} of ${boardTasks.length} tasks done on ${board.name}` : `Plan work on ${board.name}`}
        actions={
          <Button variant="primary" onClick={() => setDialog({ kind: 'create', boardId: board.id, columnId: 'todo' })}>
            <Plus /> New task <Kbd className="ml-1 hidden border-brand-foreground/20 bg-brand-foreground/10 text-brand-foreground sm:inline-flex">N</Kbd>
          </Button>
        }
      />

      <GroupBar
        noun="board"
        items={groups}
        activeId={board.id}
        canDelete={boards.length > 1}
        onSelect={setActiveBoard}
        onCreate={() => void onCreateBoard()}
        onRename={(id) => void onRenameBoard(id)}
        onInvite={setInviteFor}
        onDelete={(id) => void onDeleteBoard(id)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <InputGroup
          className="w-full sm:w-64"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          leading={<Search />}
          trailing={
            query ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
                className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent"
              >
                <X className="size-3.5" />
              </button>
            ) : undefined
          }
          placeholder="Filter tasks…"
          aria-label="Filter tasks"
          inputClassName="h-8 text-[13px]"
        />
        {members.length > 1 && (
          <Segmented<Scope>
            size="sm"
            aria-label="Task scope"
            value={scope}
            onValueChange={setScope}
            options={[
              { value: 'all', label: 'All tasks' },
              { value: 'mine', label: 'Assigned to me' },
            ]}
          />
        )}
        {filtering && <span className="text-xs text-muted-foreground">Reordering is paused while filtering</span>}

        <div
          className="ml-auto flex w-full items-center gap-2.5 sm:w-48"
          role="progressbar"
          aria-label="Tasks completed"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-brand to-success"
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={spring.soft}
            />
          </div>
          <span className="tabular w-9 text-right text-xs font-medium text-muted-foreground">{pct}%</span>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Board
          boardId={board.id}
          tasks={visible}
          members={members}
          dragDisabled={filtering}
          onOpen={(id) => setDialog({ kind: 'edit', id })}
          onDelete={(id) => {
            const t = tasks.find((x) => x.id === id);
            if (t) removeTask(t);
          }}
        />
      </div>

      <TaskDialog target={dialog} members={members} onClose={() => setDialog(null)} onDelete={removeTask} />

      {invitingBoard && (
        <InviteDialog
          open
          onOpenChange={(o) => !o && setInviteFor(null)}
          groupName={invitingBoard.name}
          noun="board"
          members={membersOf(invitingBoard.memberIds)}
          suggestions={teammates.filter((t) => !invitingBoard.memberIds.includes(t.id))}
          onInvite={(u) => inviteToBoard(invitingBoard.id, u)}
          onRemove={(pid) => removeMember(invitingBoard.id, pid)}
        />
      )}
    </div>
  );
}
