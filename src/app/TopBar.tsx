import { Search, Command, Sun, Moon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavStore, NAV_LABELS } from '@/store/useNavStore';
import { useThemeStore } from '@/store/useThemeStore';
import { useUserStore } from '@/store/useUserStore';
import { Button } from '@/components/ui/Button';
import { NotificationBell } from '@/app/NotificationPopover';

export function TopBar() {
  const active = useNavStore((s) => s.active);
  const theme = useThemeStore((s) => s.resolved);
  const toggle = useThemeStore((s) => s.toggle);
  const currentUser = useUserStore((s) => s.currentUser);
  const isHome = active === 'home';

  // Home: absolute minimal — only notification + profile, no pact/search
  if (isHome) {
    return (
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="flex h-[56px] shrink-0 items-center justify-end gap-1.5 border-b border-transparent bg-transparent px-4 md:px-6"
      >
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Button variant="ghost" size="icon" onClick={() => toggle()} className="h-8 w-8 rounded-sm border border-border bg-card" aria-label="Toggle theme">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={theme} initial={{ rotate: -30, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 30, opacity: 0 }} transition={{ duration: 0.16 }}>
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </motion.span>
            </AnimatePresence>
          </Button>
        </motion.div>
        <NotificationBell />
        <div className="ml-1 h-6 w-px bg-border" />
        <motion.div whileHover={{ scale: 1.01 }} className="flex items-center gap-3 pl-1">
          <div className="hidden text-right md:block">
            <p className="text-sm font-medium leading-none text-foreground">{currentUser?.displayName ?? 'You'}</p>
            <p className="text-xs text-muted-foreground">@{currentUser?.username ?? 'you'}</p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-muted text-sm font-medium text-foreground">
            {(currentUser?.displayName ?? 'Y').slice(0, 1).toUpperCase()}
          </div>
        </motion.div>
      </motion.header>
    );
  }

  return (
    <motion.header
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="flex h-[56px] shrink-0 items-center justify-between border-b border-border bg-background px-4 md:px-6"
    >
      <div className="flex items-center gap-3">
        <motion.h1
          key={active}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="text-sm font-semibold tracking-tight text-foreground"
        >
          {NAV_LABELS[active]}
        </motion.h1>
        <span className="hidden h-4 w-px bg-border md:block" />
        <span className="hidden text-xs text-muted-foreground md:inline">pact — your space</span>

        <div className="relative ml-4 hidden md:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Search…"
            className="h-8 w-[220px] rounded-sm border border-input bg-card pl-8 pr-12 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-ring"
          />
          <span className="pointer-events-none absolute right-1.5 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:inline-flex">
            <Command className="h-3 w-3" />K
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
          <Button variant="ghost" size="icon" onClick={() => toggle()} className="h-8 w-8 rounded-sm border border-border" aria-label="Toggle theme">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={theme} initial={{ rotate: -30, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 30, opacity: 0 }} transition={{ duration: 0.16 }}>
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </motion.span>
            </AnimatePresence>
          </Button>
        </motion.div>

        <NotificationBell />

        <div className="ml-1 h-6 w-px bg-border" />

        <motion.div whileHover={{ scale: 1.01 }} className="flex items-center gap-3 pl-1">
          <div className="hidden text-right md:block">
            <p className="text-sm font-medium leading-none text-foreground">{currentUser?.displayName ?? 'You'}</p>
            <p className="text-xs text-muted-foreground">@{currentUser?.username ?? 'you'} · {currentUser?.isOnline ? 'online' : 'offline'}</p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-muted text-sm font-medium text-foreground">
            {(currentUser?.displayName ?? 'Y').slice(0, 1).toUpperCase()}
          </div>
        </motion.div>
      </div>
    </motion.header>
  );
}
