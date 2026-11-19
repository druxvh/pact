import { SlidersHorizontal } from 'lucide-react';
import { motion } from 'motion/react';
import { Button, EmptyState, Kbd } from '@/components/ui';
import { ActivityFeed } from '@/features/activity/ActivityFeed';
import { activityFeedVisible } from '@/features/activity/feedPref';
import { Clock } from '@/features/home/Clock';
import { useHomeLayoutStore } from '@/features/home/layout';
import { OmniSearch } from '@/features/home/OmniSearch';
import { ShortcutGrid, useHomeLinks } from '@/features/home/ShortcutGrid';
import { HomeWidgets, useVisibleWidgets } from '@/features/home/widgets/HomeWidgets';
import { cn } from '@/lib/cn';
import { modCombo } from '@/lib/hotkeys';
import { fadeUp, stagger } from '@/lib/motion';
import { selectSignedIn, useAuthStore } from '@/store/useAuthStore';
import { useNavStore } from '@/store/useNavStore';
import { useSettingsStore } from '@/store/useSettingsStore';

export function HomeView() {
  const { tiles, top, links, ready } = useHomeLinks();
  const layout = useHomeLayoutStore((s) => s.layout);
  const showGreeting = useSettingsStore((s) => s.showGreeting);
  const go = useNavStore((s) => s.go);
  const signedIn = useAuthStore(selectSignedIn);
  const widgetCount = useVisibleWidgets().length;
  const activityPref = useSettingsStore((s) => s.activityFeed);
  // Notes and music of the people in your communities, under everything else (so it appears as the page is scrolled). Never for guests.
  const showActivity = signedIn && activityFeedVisible(activityPref, layout);
  // Guests can't reach Settings, and search + shortcuts are what Home offers them — never leave them with an empty page.
  const showSearch = layout.showSearch || !signedIn;
  const showShortcuts = layout.showShortcuts || !signedIn;

  const hasClock = layout.clockStyle !== 'none' || showGreeting || layout.showDate;
  const hasMain = hasClock || showSearch || showShortcuts || widgetCount > 0;
  const nothing = !hasMain && !showActivity;

  return (
    // overflow-x-hidden: the search bar effect's canvas reaches a little past the box (its glow), which on a narrow window is wider than the page.
    <div className="relative flex h-full flex-col items-center overflow-y-auto overflow-x-hidden px-4">
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
        <>
          {hasMain && (
            <motion.div
              variants={stagger(0.07, 0.02)}
              initial="hidden"
              animate="show"
              className={cn(
                'relative flex w-full max-w-5xl flex-col items-center pt-6',
                // The page is centred in its own height. With Activity below, this block is one screen (less a peek at the Activity heading,
                // which tells you there is more) and Activity starts under it.
                showActivity ? 'min-h-[calc(100%-4.5rem)] shrink-0 justify-center' : 'my-auto',
                // with widgets the page grows, so the vertical rhythm tightens a little
                widgetCount > 0 ? 'gap-8 pb-[5vh]' : 'gap-10 pb-[9vh]',
              )}
            >
              {hasClock && (
                <motion.div variants={fadeUp} className="w-full">
                  <Clock />
                </motion.div>
              )}

              {showSearch && (
                <motion.div variants={fadeUp} className="flex w-full justify-center">
                  <OmniSearch links={links} />
                </motion.div>
              )}

              {showShortcuts && (
                <motion.div variants={fadeUp} className="w-full max-w-3xl">
                  <ShortcutGrid tiles={tiles} top={top} ready={ready} />
                </motion.div>
              )}

              <HomeWidgets />

              {showSearch && layout.showHints && (
                <motion.p data-hint variants={fadeUp} className="text-center text-xs text-subtle-foreground">
                  Press <Kbd className="align-middle">/</Kbd> to search · <Kbd className="align-middle">{modCombo('K')}</Kbd> from any page to come back here
                </motion.p>
              )}
            </motion.div>
          )}
          {showActivity && <ActivityFeed className="relative shrink-0 pb-16 pt-4" />}
        </>
      )}
    </div>
  );
}
