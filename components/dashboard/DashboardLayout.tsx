import type { ReactNode } from 'react';
import { QuickHeader } from '@/components/dashboard/QuickHeader';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';
import { MiniToolsSidebar } from '@/components/mini-tools/MiniToolsSidebar';
import { RealtimeChat } from '@/components/team/RealtimeChat';

export function DashboardLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="dark mx-auto min-h-screen max-w-7xl space-y-4 p-4 md:p-6">
      <QuickHeader />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <main>{children ?? <KanbanBoard />}</main>
        <aside className="space-y-3">
          <MiniToolsSidebar />
          <RealtimeChat />
        </aside>
      </div>
    </div>
  );
}
