import { type ComponentType, type LazyExoticComponent, Suspense, lazy, useEffect } from 'react';
import { AppShell } from '@/app/AppShell';
import { Skeleton } from '@/components/ui';
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

const views = Object.fromEntries(
  (Object.keys(loaders) as Section[]).map((id) => [id, lazy(loaders[id])]),
) as Record<Section, LazyExoticComponent<ComponentType>>;

function ViewFallback() {
  return (
    <div className="space-y-4 p-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    </div>
  );
}

export default function App() {
  const section = useNavStore((s) => s.section);
  const View = views[section];

  useEffect(() => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const prefetch = () => Object.values(loaders).forEach((load) => void load());
    if (idle) idle(prefetch);
    else window.setTimeout(prefetch, 1500);
  }, []);

  return (
    <AppShell>
      <Suspense fallback={<ViewFallback />}>
        <View />
      </Suspense>
    </AppShell>
  );
}
