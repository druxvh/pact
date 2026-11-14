import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Users, UserPlus, Trash2, Columns3 } from 'lucide-react';
import { KanbanBoard } from '@/features/kanban/KanbanBoard';
import { useKanbanStore } from '@/features/kanban/store';
import { useUserStore } from '@/store/useUserStore';
import { Button } from '@/components/ui/Button';
import { useNotificationStore } from '@/store/useNotificationStore';

export function KanbanView() {
  const boards = useKanbanStore((s) => s.boards);
  const activeId = useKanbanStore((s) => s.activeBoardId);
  const setActive = useKanbanStore((s) => s.setActiveBoard);
  const createBoard = useKanbanStore((s) => s.createBoard);
  const deleteBoard = useKanbanStore((s) => s.deleteBoard);
  const invite = useKanbanStore((s) => s.inviteToBoard);
  const teammates = useUserStore((s) => s.teammates);
  const currentUser = useUserStore((s) => s.currentUser);
  const addNotify = useNotificationStore((s) => s.add);

  const activeBoard = boards.find((b) => b.id === activeId) ?? boards[0];
  const [newName, setNewName] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const allUsers = [currentUser!, ...teammates].filter(Boolean);
  const memberUsers = activeBoard ? allUsers.filter((u) => activeBoard.memberIds.includes(u.id)) : [];

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }} className="space-y-4">
      {/* Top — groups/pages (boards) */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Columns3 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold tracking-tight text-foreground">Boards</h2>
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{boards.length} groups</span>
          </div>
          <div className="flex items-center gap-1.5">
            <AnimatePresence>
              {showNew && (
                <motion.div initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 220 }} exit={{ opacity: 0, width: 0 }} className="overflow-hidden">
                  <div className="flex gap-1">
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Board name" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { if (newName.trim()) { createBoard(newName); setNewName(''); setShowNew(false); addNotify({ title: 'Board created', body: newName, kind: 'space' }); } } if (e.key === 'Escape') setShowNew(false); }} className="h-8 w-full rounded-sm border border-input bg-background px-2.5 text-sm outline-none focus:border-ring" />
                    <Button size="sm" className="h-8 rounded-sm" onClick={() => { if (newName.trim()) { createBoard(newName); addNotify({ title: 'Board created', body: newName, kind: 'space' }); } setNewName(''); setShowNew(false); }}>Create</Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <Button variant="ghost" size="sm" className="h-8 rounded-sm border border-border" onClick={() => setShowNew((v) => !v)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> New board
            </Button>
          </div>
        </div>

        {/* Boards as pages — minimal, no heavy border */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {boards.map((b) => {
            const isActive = b.id === activeBoard?.id;
            const members = allUsers.filter((u) => b.memberIds.includes(u.id));
            return (
              <motion.button
                key={b.id}
                onClick={() => setActive(b.id)}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                className={`group flex shrink-0 items-center gap-2.5 rounded-sm border px-3 py-2 text-left transition-colors ${isActive ? 'border-accent bg-accent text-accent-foreground shadow-sm' : 'border-border bg-card hover:border-accent/30 hover:bg-accent/5'}`}
              >
                <span className={`flex h-6 w-6 items-center justify-center rounded-sm text-xs font-medium ${isActive ? 'bg-accent-foreground text-accent' : 'bg-muted text-muted-foreground'}`}>
                  {b.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className={`block truncate text-sm font-medium ${isActive ? 'text-accent-foreground' : 'text-foreground'}`}>{b.name}</span>
                  <span className={`block text-xs ${isActive ? 'text-accent-foreground/80' : 'text-muted-foreground'}`}>{members.length} members · {members.map((m) => m.username).join(', ').slice(0, 22)}</span>
                </span>
                <span className={`ml-1 hidden rounded-sm px-1.5 py-0.5 text-xs font-mono ${isActive ? 'bg-accent-foreground text-accent' : 'bg-muted text-muted-foreground'}`}>{useKanbanStore.getState().tasks.filter((t) => t.boardId === b.id).length}</span>
              </motion.button>
            );
          })}
        </div>

        {/* Active board header — members + invite */}
        {activeBoard && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm bg-muted/20 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <div className="flex -space-x-1.5">
                {memberUsers.slice(0, 6).map((u) => (
                  <span key={u.id} className="flex h-7 w-7 items-center justify-center rounded-sm border border-background bg-card text-xs font-medium text-foreground" title={`${u.displayName} @${u.username}`}>
                    {u.displayName.slice(0, 1).toUpperCase()}
                  </span>
                ))}
                {memberUsers.length > 6 && <span className="flex h-7 w-7 items-center justify-center rounded-sm border border-background bg-muted text-xs text-muted-foreground">+{memberUsers.length - 6}</span>}
              </div>
              <span className="text-sm font-medium text-foreground">{activeBoard.name}</span>
              <span className="hidden text-xs text-muted-foreground md:inline">· {memberUsers.map((m) => `@${m.username}`).join(' ')}</span>
              <button
                onClick={() => {
                  if (boards.length <= 1) return;
                  if (confirm(`Delete board "${activeBoard.name}"?`)) deleteBoard(activeBoard.id);
                }}
                className="ml-2 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                title="Delete board"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="relative flex items-center gap-1">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Invite @username"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const r = invite(activeBoard.id, inviteName);
                      setInviteMsg(r.msg);
                      if (r.ok) {
                        addNotify({ title: 'Invited to board', body: `${r.msg} → ${activeBoard.name}`, kind: 'space' });
                        setInviteName('');
                      }
                      setTimeout(() => setInviteMsg(null), 2200);
                    }
                  }}
                  className="h-7 w-32 rounded-sm border border-input bg-background px-2 text-xs outline-none focus:border-ring md:w-36"
                />
                <Button
                  size="sm"
                  className="h-7 rounded-sm px-2.5"
                  onClick={() => {
                    const r = invite(activeBoard.id, inviteName);
                    setInviteMsg(r.msg);
                    if (r.ok) {
                      addNotify({ title: 'Invited to board', body: `${r.msg} → ${activeBoard.name}`, kind: 'space' });
                      setInviteName('');
                    }
                    setTimeout(() => setInviteMsg(null), 2200);
                  }}
                >
                  <UserPlus className="mr-1 h-3 w-3" /> Invite
                </Button>
              </div>
              <span className="hidden text-xs text-muted-foreground md:inline">Try @alex @jordan @sam @riley</span>
            </div>
          </div>
        )}
        <AnimatePresence>
          {inviteMsg && (
            <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-xs text-muted-foreground">
              {inviteMsg}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Board content — minimal, no outer border */}
      <div className="rounded-sm bg-background">
        <KanbanBoard />
      </div>

    </motion.div>
  );
}
