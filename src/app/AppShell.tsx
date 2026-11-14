import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sidebar } from '@/app/Sidebar';
import { TopBar } from '@/app/TopBar';
import { useNavStore } from '@/store/useNavStore';

export function AppShell({ children }: { children: ReactNode }) {
  const active = useNavStore((s) => s.active);

  const isHome = active === 'home';
  return (
    <div className="flex h-screen min-h-screen w-full bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <TopBar />
        <AnimatePresence mode="wait">
          <motion.main
            key={active}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`flex-1 overflow-y-auto bg-background ${isHome ? 'p-0' : 'p-4 md:p-6'}`}
          >
            <div className={isHome ? 'w-full' : 'mx-auto w-full max-w-[1400px]'}>{children}</div>
          </motion.main>
        </AnimatePresence>
      </div>
    </div>
  );
}
