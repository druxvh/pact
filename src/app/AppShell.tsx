import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { type ReactNode, useEffect, useRef } from 'react';
import { CommandPalette } from '@/app/CommandPalette';
import { SECTION_BY_ID, SECTIONS, baseTitle } from '@/app/routes';
import { TimerEngine } from '@/features/timer/TimerEngine';
import { useTimerStore } from '@/features/timer/store';
import { ShortcutsDialog } from '@/app/ShortcutsDialog';
import { MobileNav, Sidebar } from '@/app/Sidebar';
import { TopBar } from '@/app/TopBar';
import { ConfirmHost, PromptHost, Toaster, TooltipProvider } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useHotkeys } from '@/lib/hotkeys';
import { page } from '@/lib/motion';
import { useNavStore } from '@/store/useNavStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useUiStore } from '@/store/useUiStore';

export function AppShell({ children }: { children: ReactNode }) {
  const section = useNavStore((s) => s.section);
  const go = useNavStore((s) => s.go);
  const motionPref = useSettingsStore((s) => s.motion);
  const togglePalette = useUiStore((s) => s.togglePalette);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const overlayOpen = useUiStore((s) => s.paletteOpen || s.shortcutsOpen);
  const mainRef = useRef<HTMLElement>(null);
  const meta = SECTION_BY_ID[section];

  // New page → start at the top.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [section]);

  // Keep the document title in sync (helps tab search & screen readers).
  // (While the timer runs, TimerEngine owns the title so it can show the countdown.)
  useEffect(() => {
    if (useTimerStore.getState().status !== 'running') document.title = baseTitle(section);
  }, [section]);

  useHotkeys([
    { keys: 'mod+k', allowInInput: true, handler: togglePalette },
    { keys: '?', enabled: !overlayOpen, handler: () => setShortcutsOpen(true) },
    ...SECTIONS.map((s) => ({
      keys: `g ${s.hotkey}`,
      enabled: !overlayOpen,
      handler: () => go(s.id),
    })),
  ]);

  return (
    <MotionConfig reducedMotion={motionPref === 'system' ? 'user' : motionPref === 'reduced' ? 'always' : 'never'}>
      <TooltipProvider>
        <div className="relative isolate flex h-full w-full">
          <div aria-hidden="true" className="bg-ambient pointer-events-none absolute inset-0 -z-10" />
          <a
            href="#main"
            className="sr-only z-50 rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-foreground focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
          >
            Skip to content
          </a>

          <Sidebar />

          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main id="main" ref={mainRef} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={section}
                  {...page}
                  className={cn(meta.bleed ? 'h-full' : 'mx-auto w-full max-w-[1240px] px-4 py-6 md:px-8 md:py-8')}
                >
                  {children}
                </motion.div>
              </AnimatePresence>
            </main>
            <MobileNav />
          </div>
        </div>

        <TimerEngine />
        <Toaster />
        <ConfirmHost />
        <PromptHost />
        <CommandPalette />
        <ShortcutsDialog />
      </TooltipProvider>
    </MotionConfig>
  );
}
