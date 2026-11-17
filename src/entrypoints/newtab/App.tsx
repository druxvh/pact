import { type ComponentType, type LazyExoticComponent, lazy, Suspense, useEffect } from 'react';
import { AppShell } from '@/app/AppShell';
import { needsAccount, SECTION_BY_ID } from '@/app/routes';
import { SignInGate } from '@/app/SignIn';
import { PageSkeleton } from '@/components/skeletons/PageSkeleton';
import { useAuthStore } from '@/store/useAuthStore';
import { type Section, useNavStore } from '@/store/useNavStore';

/**
 * Each section is its own chunk so the new tab paints fast; the rest are
 * prefetched when the browser is idle so navigation is instant.
 */
const loaders: Record<Section, () => Promise<{ default: ComponentType }>> = {
  home: () => import('@/features/home/HomeView').then((m) => ({ default: m.HomeView })),
  notes: () => import('@/features/notes/NotesView').then((m) => ({ default: m.NotesView })),
  kanban: () => import('@/features/kanban/KanbanView').then((m) => ({ default: m.KanbanView })),
  timer: () => import('@/features/timer/TimerView').then((m) => ({ default: m.TimerView })),
  tools: () => import('@/features/tools/ToolsView').then((m) => ({ default: m.ToolsView })),
  chat: () => import('@/features/chat/ChatView').then((m) => ({ default: m.ChatView })),
  party: () => import('@/features/party/PartyView').then((m) => ({ default: m.PartyView })),
  settings: () => import('@/features/settings/SettingsView').then((m) => ({ default: m.SettingsView })),
};

const views = Object.fromEntries((Object.keys(loaders) as Section[]).map((id) => [id, lazy(loaders[id])])) as Record<
  Section,
  LazyExoticComponent<ComponentType>
>;

/** The loading state is the page's own shape, so nothing jumps when the real view arrives. */
function ViewFallback({ section }: { section: Section }) {
  return <PageSkeleton section={section} label={SECTION_BY_ID[section].label} />;
}

export default function App() {
  const section = useNavStore((s) => s.section);
  const View = views[section];
  const status = useAuthStore((s) => s.status);
  const locked = needsAccount(section) && status !== 'signedIn';

  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const prefetch = () => Object.values(loaders).forEach((load) => void load());
    if (idle) idle(prefetch);
    else window.setTimeout(prefetch, 1500);
  }, []);

  return (
    <AppShell>
      {locked ? (
        // A stored session is still being checked → don't flash the sign-in prompt at someone who's already signed in.
        status === 'loading' ? (
          <ViewFallback section={section} />
        ) : (
          <SignInGate section={section} />
        )
      ) : (
        <Suspense fallback={<ViewFallback section={section} />}>
          <View />
        </Suspense>
      )}
    </AppShell>
  );
}
