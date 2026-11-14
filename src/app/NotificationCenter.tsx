import { Bell, BellOff, CheckCheck, MessageCircleMore, Timer, UserPlus, Users, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Badge, Button, IconButton, Popover, PopoverContent, PopoverTrigger } from '@/components/ui';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { spring } from '@/lib/motion';
import { useNavStore } from '@/store/useNavStore';
import {
  type Notification,
  type NotificationKind,
  selectUnreadCount,
  useNotificationStore,
} from '@/store/useNotificationStore';

const ICONS: Record<NotificationKind, React.ComponentType<{ className?: string }>> = {
  chat: MessageCircleMore,
  friend: UserPlus,
  space: Users,
  timer: Timer,
  system: Bell,
};

function Row({ n, onOpen }: { n: Notification; onOpen: (n: Notification) => void }) {
  const dismiss = useNotificationStore((s) => s.dismiss);
  const Icon = ICONS[n.kind ?? 'system'];
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
      transition={spring.soft}
      className="group relative"
    >
      <button
        type="button"
        onClick={() => onOpen(n)}
        className={cn(
          'flex w-full items-start gap-3 px-4 py-3 text-left outline-offset-[-2px] transition-colors hover:bg-accent',
          !n.read && 'bg-brand-soft/60',
        )}
      >
        <span
          className={cn(
            'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
            n.read ? 'bg-muted text-muted-foreground' : 'bg-brand-soft text-brand-text',
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] font-medium">{n.title}</span>
            <span className="shrink-0 text-[11px] text-subtle-foreground">{relativeTime(n.createdAt)}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>
        </span>
        {!n.read && <span aria-label="Unread" className="mt-2 size-2 shrink-0 rounded-full bg-brand" />}
      </button>
      <IconButton
        label="Dismiss"
        size="icon-xs"
        tooltip={false}
        onClick={() => dismiss(n.id)}
        className="absolute right-2 top-2 bg-popover opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        <X />
      </IconButton>
    </motion.li>
  );
}

export function NotificationCenter() {
  const notifications = useNotificationStore((s) => s.notifications);
  const unread = useNotificationStore(selectUnreadCount);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const clearAll = useNotificationStore((s) => s.clearAll);
  const go = useNavStore((s) => s.go);
  const [open, setOpen] = useState(false);

  const openItem = (n: Notification) => {
    markRead(n.id);
    if (n.link) {
      go(n.link.section, n.link.sub ?? null);
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <IconButton label={unread ? `Notifications (${unread} unread)` : 'Notifications'} className="relative" />
        }
      >
        <Bell />
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              key="badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={spring.bouncy}
              className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold leading-4 text-brand-foreground ring-2 ring-background"
            >
              {unread > 9 ? '9+' : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[min(380px,calc(100vw-24px))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Notifications</h2>
            {unread > 0 && <Badge tone="brand">{unread} new</Badge>}
          </div>
          <Button variant="ghost" size="xs" onClick={markAllRead} disabled={unread === 0}>
            <CheckCheck /> Mark all read
          </Button>
        </div>

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
            <span className="mb-2 grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
              <BellOff className="size-5" />
            </span>
            <p className="text-sm font-medium">You're all caught up</p>
            <p className="text-xs text-muted-foreground">Friend requests, messages and timers show up here.</p>
          </div>
        ) : (
          <>
            <ul className="max-h-[min(420px,60vh)] divide-y overflow-y-auto">
              <AnimatePresence initial={false}>
                {notifications.map((n) => (
                  <Row key={n.id} n={n} onOpen={openItem} />
                ))}
              </AnimatePresence>
            </ul>
            <div className="flex justify-end border-t px-3 py-2">
              <Button variant="ghost" size="xs" onClick={clearAll}>
                Clear all
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
