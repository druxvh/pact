import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { type ReactNode, useEffect, useRef } from 'react';
import { CommandPalette } from '@/app/CommandPalette';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { Onboarding } from '@/app/Onboarding';
import { openOmnibox } from '@/app/openOmnibox';
import { baseTitle, SECTION_BY_ID, SECTIONS } from '@/app/routes';
import { ShortcutsDialog } from '@/app/ShortcutsDialog';
import { MobileNav, Sidebar } from '@/app/Sidebar';
import { SignInDialog } from '@/app/SignIn';
import { TopBar } from '@/app/TopBar';
import { WallpaperLayer } from '@/app/WallpaperLayer';
import { ConfirmHost, PromptHost, Toaster, TooltipProvider } from '@/components/ui';
import { useActivityBackground, useUnreadActivity } from '@/features/activity/hooks';
import { NoteComposerHost } from '@/features/activity/NoteComposer';
import { CameraHost } from '@/features/camera/CameraHost';
import { CaptureDialog } from '@/features/capture/CaptureDialog';
import { selectTotalUnread, useChatStore } from '@/features/chat/store';
import { useTitleBadge } from '@/features/community/titleBadge';
import { useCommunityBackground, useCommunityUnreadTotal } from '@/features/community/useCommunityStore';
import { useNowPlayingSync } from '@/features/nowplaying/sync';
import { StyleWallpaper } from '@/features/stylewall/StyleWallpaper';
import { useTimerStore } from '@/features/timer/store';
import { TimerEngine } from '@/features/timer/TimerEngine';
import { useTourStore } from '@/features/tour/store';
import { Tour } from '@/features/tour/Tour';
import { cn } from '@/lib/cn';
import { useHotkeys } from '@/lib/hotkeys';
import { page } from '@/lib/motion';
import { reconcileDemo } from '@/store/demoServer';
import { selectSignedIn, useAuthStore } from '@/store/useAuthStore';
import { useNavStore } from '@/store/useNavStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useUiStore } from '@/store/useUiStore';

export function AppShell({ children }: { children: ReactNode }) {
  const section = useNavStore((s) => s.section);
  const go = useNavStore((s) => s.go);
  const motionPref = useSettingsStore((s) => s.motion);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const setCaptureOpen = useUiStore((s) => s.setCaptureOpen);
  const tourActive = useTourStore((s) => s.active);
  // While the first-run tour (or any of these) is up, the page's own hotkeys stay quiet.
  const overlayOpen = useUiStore((s) => s.paletteOpen || s.shortcutsOpen || s.captureOpen || s.cameraOpen) || tourActive;
  const signedIn = useAuthStore(selectSignedIn);
  // Chat badge = direct-message unread + community unread (muted communities excluded). The community feed runs for the
  // whole signed-in app, not just while the Chat tab is open.
  useCommunityBackground();
  // "Now playing": mirrors the preference to the service worker, follows the account's sharing setting and what plays in this browser.
  useNowPlayingSync();
  // Notes, hearts, comments and private replies: live for the whole signed-in app, so a heart shows up in the bell wherever you are.
  useActivityBackground();
  const chatUnread = useChatStore(selectTotalUnread) + useCommunityUnreadTotal() + useUnreadActivity();
  // `(3) …` in the tab title while the tab is hidden or you're on another section. It decorates whatever title is set
  // (this file's, or TimerEngine's countdown) instead of replacing it.
  useTitleBadge(signedIn ? chatUnread : 0, section !== 'chat');
  const badges = chatUnread > 0 ? { chat: chatUnread } : {};
  const mainRef = useRef<HTMLElement>(null);
  const meta = SECTION_BY_ID[section];

  // Resolve any simulated friend request whose timer was lost when a tab closed.
  useEffect(() => {
    reconcileDemo();
  }, []);

  // Lets a style's CSS-only animations (Dusk's breathing colon, the style wallpaper) follow the in-app Animations setting, not only the OS one.
  useEffect(() => {
    document.documentElement.dataset.motion = motionPref;
  }, [motionPref]);

  // New page → start at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `section` is the trigger, not a value the effect reads
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [section]);

  // Keep the document title in sync (helps tab search & screen readers).
  // (While the timer runs, TimerEngine owns the title so it can show the countdown.)
  useEffect(() => {
    if (useTimerStore.getState().status !== 'running') document.title = baseTitle(section);
  }, [section]);

  useHotkeys([
    // ⌘K is "the omnibox" everywhere: it focuses Home's search box, and opens (or closes) the overlay palette on other pages.
    { keys: 'mod+k', allowInInput: true, enabled: !tourActive, handler: () => openOmnibox() },
    { keys: 'c', enabled: !overlayOpen, handler: () => setCaptureOpen(true) },
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
          <WallpaperLayer />
          <StyleWallpaper />
          <div aria-hidden="true" className="bg-ambient pointer-events-none absolute inset-0 -z-10" />
          {/* a real anchor would rewrite the URL hash, which is the router — so it just moves focus */}
          <button
            type="button"
            onClick={() => mainRef.current?.focus()}
            className="sr-only z-50 rounded-md bg-brand px-3 py-2 text-sm font-medium text-brand-foreground focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
          >
            Skip to content
          </button>

          <Sidebar badges={badges} />

          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main id="main" ref={mainRef} tabIndex={-1} data-section={section} className="min-h-0 flex-1 overflow-y-auto outline-none">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={section} {...page} className={cn(meta.bleed ? 'h-full' : 'mx-auto w-full max-w-[1240px] px-4 py-6 md:px-8 md:py-8')}>
                  <ErrorBoundary resetKey={section} label={meta.label}>
                    {children}
                  </ErrorBoundary>
                </motion.div>
              </AnimatePresence>
            </main>
            <MobileNav badges={badges} />
          </div>
        </div>

        <TimerEngine />
        <Toaster />
        <ConfirmHost />
        <PromptHost />
        <CommandPalette />
        <ShortcutsDialog />
        <SignInDialog />
        <CaptureDialog />
        <CameraHost />
        <NoteComposerHost />
        <Onboarding />
        <Tour />
      </TooltipProvider>
    </MotionConfig>
  );
}
