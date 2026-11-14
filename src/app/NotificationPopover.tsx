import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, CheckCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useNotificationStore } from '@/store/useNotificationStore';

export function NotificationBell() {
  const notifications = useNotificationStore((s) => s.notifications);
  const unread = notifications.filter((n) => !n.read).length;
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const add = useNotificationStore((s) => s.add);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div ref={ref} className="relative">
      <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 rounded-sm border border-border bg-card"
          aria-label="Notifications"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((v) => !v)}
        >
          <Bell className="h-4 w-4" />
          <AnimatePresence>
            {unread > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground"
              >
                {unread}
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-full z-40 mt-2 w-[360px] overflow-hidden rounded-sm border border-border bg-popover shadow-xl"
            role="dialog"
            aria-label="Notifications"
          >
            <div className="flex items-center justify-between border-b border-border bg-card px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-foreground">Notifications</p>
                <p className="text-xs text-muted-foreground">{unread} unread · {notifications.length} total</p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 rounded-sm px-2 text-xs" onClick={markAllRead}>
                  <CheckCheck className="mr-1 h-3 w-3" /> Read all
                </Button>
                <button onClick={() => setOpen(false)} className="rounded-sm p-1 text-muted-foreground hover:bg-accent" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="max-h-[380px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell className="mx-auto h-6 w-6 text-muted-foreground/40" />
                  <p className="mt-2 text-sm font-medium text-foreground">All caught up</p>
                  <p className="text-xs text-muted-foreground">No notifications</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 h-7 rounded-sm text-xs"
                    onClick={() => add({ title: 'Test notification', body: 'Hello from pact', kind: 'system' })}
                  >
                    + Test
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {notifications.map((n) => (
                    <div key={n.id} className={`flex items-start gap-2 p-3 ${n.read ? 'bg-popover' : 'bg-accent/10'}`}>
                      <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-border' : 'bg-accent'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-4 text-foreground">{n.title}</p>
                        <p className="mt-1 text-xs leading-4 text-muted-foreground">{n.body}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{new Date(n.createdAt).toLocaleString()} · {n.kind}</p>
                      </div>
                      <button
                        onClick={() => dismiss(n.id)}
                        className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                        aria-label="Dismiss"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">Synced</p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 rounded-sm text-xs"
                onClick={() => {
                  notifications.forEach((n) => dismiss(n.id));
                }}
              >
                Clear all
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
