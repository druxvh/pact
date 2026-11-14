import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useUserStore } from '@/store/useUserStore';
import { useThemeStore } from '@/store/useThemeStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useNotesStore } from '@/features/notes/store';
import { useKanbanStore } from '@/features/kanban/store';
import { useChatStore } from '@/features/chat/store';
import { Moon, Sun, Trash2 } from 'lucide-react';

export function SettingsView() {
  const user = useUserStore((s) => s.currentUser);
  const updateProfile = useUserStore((s) => s.updateProfile);
  const spaces = useUserStore((s) => s.spaces);
  const teammates = useUserStore((s) => s.teammates);
  const theme = useThemeStore((s) => s.resolved);
  const setTheme = useThemeStore((s) => s.setMode);
  const notifications = useNotificationStore((s) => s.notifications);
  const dismiss = useNotificationStore((s) => s.dismiss);

  const [form, setForm] = useState({
    displayName: user?.displayName ?? '',
    username: user?.username ?? '',
    designation: user?.designation ?? '',
    bio: user?.bio ?? '',
    email: user?.email ?? '',
  });
  const [saved, setSaved] = useState(false);

  const stats = {
    notes: useNotesStore((s) => s.notes.length),
    tasks: useKanbanStore((s) => s.tasks.length),
    chats: useChatStore((s) => s.messages.length),
    spaces: spaces.length,
  };

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }} className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Settings</h2>
        <p className="text-xs text-muted-foreground">Profile, appearance & sync</p>
      </div>

      <Card>
        <h3 className="text-sm font-medium text-foreground">Profile</h3>
        <p className="mt-1 text-xs text-muted-foreground">Shown in top bar and chats. Username is how friends add you (like insta).</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs text-muted-foreground">Display name</label>
            <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} className="mt-1 h-9 w-full rounded-sm border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-ring" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Username</label>
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\s/g, '').toLowerCase() })} placeholder="you" className="mt-1 h-9 w-full rounded-sm border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-ring" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Designation</label>
            <input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} className="mt-1 h-9 w-full rounded-sm border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-ring" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Email</label>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 h-9 w-full rounded-sm border border-input bg-background px-3 text-sm outline-none transition-colors focus:border-ring" />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground">Bio</label>
            <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} rows={2} className="mt-1 w-full resize-none rounded-sm border border-input bg-background p-3 text-sm outline-none transition-colors focus:border-ring" placeholder="What do you do?" />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <AnimatePresence>
            {saved ? (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-xs text-emerald-600 dark:text-emerald-400">✓ Saved</motion.p>
            ) : (
              <span className="text-xs text-transparent">.</span>
            )}
          </AnimatePresence>
          <Button
            className="rounded-sm"
            onClick={() => {
              updateProfile({ displayName: form.displayName || 'You', username: form.username || 'you', designation: form.designation, bio: form.bio, email: form.email });
              setSaved(true);
              setTimeout(() => setSaved(false), 2000);
            }}
          >
            Save
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-medium text-foreground">Appearance</h3>
        <p className="mt-1 text-xs text-muted-foreground">Black is default. Switch to light anytime.</p>
        <div className="mt-3 flex items-center justify-between rounded-sm border border-border bg-muted p-3">
          <div>
            <p className="text-sm font-medium text-foreground">Theme</p>
            <p className="text-xs text-muted-foreground">Switch theme</p>
          </div>
          <div className="flex gap-1 rounded-sm border border-border bg-background p-1">
            <button onClick={() => setTheme('light')} className={`flex items-center gap-1 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${theme === 'light' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}><Sun className="h-3.5 w-3.5" /> Light</button>
            <button onClick={() => setTheme('dark')} className={`flex items-center gap-1 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${theme === 'dark' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}><Moon className="h-3.5 w-3.5" /> Dark</button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-sm border border-border bg-background p-3">
            <p className="text-xs text-muted-foreground">Background</p>
            <p className="font-mono text-sm text-foreground">{theme === 'dark' ? '#000000' : '#FFFFFF'}</p>
          </div>
          <div className="rounded-sm border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">Card</p>
            <p className="font-mono text-sm text-foreground">{theme === 'dark' ? '#0a0a0a' : '#FFFFFF'}</p>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-medium text-foreground">Sync & data</h3>
        <p className="mt-1 text-sm text-muted-foreground">All data syncs across your devices.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            { k: 'Notes', v: stats.notes },
            { k: 'Tasks', v: stats.tasks },
            { k: 'Messages', v: stats.chats },
            { k: 'Spaces', v: stats.spaces },
          ].map((s) => (
            <motion.div key={s.k} whileHover={{ y: -1 }} className="rounded-sm border border-border bg-background p-3 text-center">
              <p className="text-2xl font-semibold tracking-tight text-foreground">{s.v}</p>
              <p className="text-xs text-muted-foreground">{s.k}</p>
            </motion.div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" className="rounded-sm" onClick={() => { localStorage.clear(); location.reload(); }}>Clear data</Button>
          <span className="text-xs leading-8 text-muted-foreground">Resets to defaults</span>
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-medium text-foreground">Spaces</h3>
        <p className="mt-1 text-xs text-muted-foreground">Invite by username → share kanban/notes/chats.</p>
        <div className="mt-3 space-y-2">
          {spaces.map((sp) => (
            <div key={sp.id} className="flex items-center justify-between rounded-sm border border-border bg-background p-3">
              <div>
                <p className="text-sm font-medium text-foreground">{sp.name}</p>
                <p className="text-xs text-muted-foreground">{sp.memberIds.map((id) => (id === 'local-user' ? user?.username ?? 'you' : teammates.find((t) => t.id === id)?.username ?? id)).join(', ')}</p>
              </div>
              <span className="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground">{sp.memberIds.length} members</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground">Notifications · {notifications.filter((n) => !n.read).length} unread</h3>
          <Button variant="ghost" size="sm" className="rounded-sm" onClick={() => notifications.forEach((n) => dismiss(n.id))}>Clear all</Button>
        </div>
        <div className="mt-3 space-y-2">
          {notifications.length === 0 ? (
            <p className="text-xs text-muted-foreground">No notifications</p>
          ) : (
            notifications.slice(0, 8).map((n) => (
              <div key={n.id} className={`flex items-start justify-between gap-2 rounded-sm border p-3 ${n.read ? 'border-border bg-background' : 'border-primary/20 bg-accent'}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{n.title}</p>
                  <p className="text-xs text-muted-foreground">{n.body}</p>
                  <p className="text-[11px] text-muted-foreground">{new Date(n.createdAt).toLocaleString()} · {n.kind}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-sm" onClick={() => dismiss(n.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))
          )}
        </div>
      </Card>
    </motion.div>
  );
}
