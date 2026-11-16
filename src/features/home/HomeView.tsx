import { SlidersHorizontal } from 'lucide-react';
import { motion } from 'motion/react';
import { Button, EmptyState } from '@/components/ui';
import { Clock } from '@/features/home/Clock';
import { useHomeLayoutStore } from '@/features/home/layout';
import { OmniSearch } from '@/features/home/OmniSearch';
import { ShortcutGrid, useHomeLinks } from '@/features/home/ShortcutGrid';
import { HomeWidgets } from '@/features/home/widgets/HomeWidgets';
import { cn } from '@/lib/cn';
import { fadeUp, stagger } from '@/lib/motion';
import { useNavStore } from '@/store/useNavStore';
import { useSettingsStore } from '@/store/useSettingsStore';

export function HomeView() {
  const { tiles, top, links } = useHomeLinks();
  const layout = useHomeLayoutStore((s) => s.layout);
  const showGreeting = useSettingsStore((s) => s.showGreeting);
  const go = useNavStore((s) => s.go);

  const hasClock = layout.clockStyle !== 'none' || showGreeting || layout.showDate;
  const nothing = !hasClock && !layout.showSearch && !layout.showShortcuts && layout.widgets.length === 0;

  return (
    <div className="relative flex h-full flex-col items-center overflow-y-auto px-4">
      <div aria-hidden="true" className="bg-dots pointer-events-none absolute inset-x-0 top-0 h-[75%] opacity-70" />

      {nothing ? (
        <div className="relative my-auto">
          <EmptyState
            icon={SlidersHorizontal}
            title="Your home is empty"
            description="Everything on this page is switched off. Pick a layout in Settings to bring it back."
            action={
              <Button variant="primary" onClick={() => go('settings')}>
                Customize Home
              </Button>
            }
          />
        </div>
      ) : (
        <motion.div
          variants={stagger(0.07, 0.02)}
          initial="hidden"
          animate="show"
          className={cn(
            'relative my-auto flex w-full max-w-5xl flex-col items-center pt-6',
            // with widgets the page grows, so the vertical rhythm tightens a little
            layout.widgets.length > 0 ? 'gap-8 pb-[5vh]' : 'gap-10 pb-[9vh]',
          )}
        >
          {hasClock && (
            <motion.div variants={fadeUp} className="w-full">
              <Clock />
            </motion.div>
          )}

          {layout.showSearch && (
            <motion.div variants={fadeUp} className="flex w-full justify-center">
              <OmniSearch links={links} />
            </motion.div>
          )}

          {layout.showShortcuts && (
            <motion.div variants={fadeUp} className="w-full max-w-3xl">
              <ShortcutGrid tiles={tiles} top={top} />
            </motion.div>
          )}

          <HomeWidgets />

          {layout.showSearch && layout.showHints && (
            <motion.p variants={fadeUp} className="text-center text-xs text-subtle-foreground">
              Press <kbd className="rounded-sm border bg-muted px-1 font-mono text-[10px]">/</kbd> to search ·{' '}
              <kbd className="rounded-sm border bg-muted px-1 font-mono text-[10px]">⌘K</kbd> for everything else
            </motion.p>
          )}
        </motion.div>
      )}
    </div>
  );
}
