import {
  Clock3,
  Columns3,
  House,
  MessageCircleMore,
  NotebookPen,
  Settings,
  Wrench,
  Moon,
  Sun,
} from 'lucide-react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { cn } from '@/lib/cn';
import { useNavStore, type NavSection } from '@/store/useNavStore';
import { useThemeStore } from '@/store/useThemeStore';
import { useUserStore } from '@/store/useUserStore';

type NavItem = {
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'notes', label: 'Notes', icon: NotebookPen },
  { id: 'kanban', label: 'Kanban', icon: Columns3 },
  { id: 'timer', label: 'Timer', icon: Clock3 },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'chatrooms', label: 'Chats', icon: MessageCircleMore },
];

const BOTTOM_ITEMS: NavItem[] = [
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const active = useNavStore((s) => s.active);
  const setActive = useNavStore((s) => s.setActive);
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  const currentUser = useUserStore((s) => s.currentUser);

  return (
    <motion.aside
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="flex h-screen w-[68px] shrink-0 flex-col items-center border-r border-border bg-background py-4"
    >
      {/* Logo — minimal rounded-sm, premium */}
      <motion.div
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="mb-6 flex h-9 w-9 items-center justify-center rounded-sm bg-primary text-[13px] font-bold tracking-tighter text-primary-foreground"
      >
        p.
      </motion.div>

      <LayoutGroup>
        <nav className="flex flex-1 flex-col items-center gap-1.5">
          {NAV_ITEMS.map((item) => {
            const isActive = active === item.id;
            return (
              <motion.button
                key={item.id}
                onClick={() => setActive(item.id)}
                aria-label={item.label}
                title={item.label}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 400, damping: 24 }}
                className={cn(
                  'group relative flex h-9 w-9 items-center justify-center rounded-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <item.icon className="h-[17px] w-[17px]" />
                <AnimatePresence>
                  {isActive && (
                    <motion.span
                      layoutId="sidebar-indicator"
                      initial={{ opacity: 0, scaleY: 0.6 }}
                      animate={{ opacity: 1, scaleY: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="absolute -left-[14px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-primary"
                    />
                  )}
                </AnimatePresence>
              </motion.button>
            );
          })}
        </nav>
      </LayoutGroup>

      <div className="flex flex-col items-center gap-1.5">
        <motion.button
          onClick={toggle}
          aria-label="Toggle theme"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.96 }}
          className="flex h-9 w-9 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={theme}
              initial={{ rotate: -90, opacity: 0, scale: 0.8 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: 90, opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </motion.span>
          </AnimatePresence>
        </motion.button>

        <div className="my-1 h-px w-8 bg-border" />

        {BOTTOM_ITEMS.map((item) => {
          const isActive = active === item.id;
          return (
            <motion.button
              key={item.id}
              onClick={() => setActive(item.id)}
              aria-label={item.label}
              title={item.label}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-sm transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <item.icon className="h-[17px] w-[17px]" />
            </motion.button>
          );
        })}

        <motion.div
          whileHover={{ scale: 1.05 }}
          className="mt-3 flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-muted text-[11px] font-medium text-muted-foreground"
        >
          {(currentUser?.displayName ?? 'Y').slice(0, 1).toUpperCase()}
        </motion.div>
      </div>
    </motion.aside>
  );
}
