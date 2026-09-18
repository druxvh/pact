import { DashboardLayout } from '@/components/dashboard/DashboardLayout';
import { KanbanBoard } from '@/components/kanban/KanbanBoard';

export default function App() {
  return (
    <DashboardLayout>
      <KanbanBoard />
    </DashboardLayout>
  );
}
