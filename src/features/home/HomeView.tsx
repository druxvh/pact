import { motion } from 'motion/react';
import { Clock } from '@/features/home/Clock';
import { OmniSearch } from '@/features/home/OmniSearch';
import { ShortcutGrid, useHomeLinks } from '@/features/home/ShortcutGrid';
import { fadeUp, stagger } from '@/lib/motion';

export function HomeView() {
  const { tiles, top, links } = useHomeLinks();

  return (
    <div className="relative flex h-full flex-col items-center overflow-y-auto px-4">
      <div aria-hidden="true" className="bg-dots pointer-events-none absolute inset-x-0 top-0 h-[75%] opacity-70" />

      <motion.div
        variants={stagger(0.07, 0.02)}
        initial="hidden"
        animate="show"
        className="relative my-auto flex w-full max-w-3xl flex-col items-center gap-10 pb-[9vh] pt-6"
      >
        <motion.div variants={fadeUp} className="w-full">
          <Clock />
        </motion.div>

        <motion.div variants={fadeUp} className="flex w-full justify-center">
          <OmniSearch links={links} />
        </motion.div>

        <motion.div variants={fadeUp} className="w-full">
          <ShortcutGrid tiles={tiles} top={top} />
        </motion.div>

        <motion.p variants={fadeUp} className="text-center text-xs text-subtle-foreground">
          Press <kbd className="rounded-sm border bg-muted px-1 font-mono text-[10px]">/</kbd> to search ·{' '}
          <kbd className="rounded-sm border bg-muted px-1 font-mono text-[10px]">⌘K</kbd> for everything else
        </motion.p>
      </motion.div>
    </div>
  );
}
