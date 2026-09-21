import { AppShell } from '@/components/layout/AppShell';
import { HomeView } from '@/components/sections/HomeView';
import { NotesView } from '@/components/sections/NotesView';
import { KanbanView } from '@/components/sections/KanbanView';
import { TimerView } from '@/components/sections/TimerView';
import { ToolsView } from '@/components/sections/ToolsView';
import { ChatroomsView } from '@/components/sections/ChatroomsView';
import { SettingsView } from '@/components/sections/SettingsView';
import { useNavStore } from '@/store/useNavStore';

export default function App() {
  const active = useNavStore((s) => s.active);

  return (
    <AppShell>
      {active === 'home' && <HomeView />}
      {active === 'notes' && <NotesView />}
      {active === 'kanban' && <KanbanView />}
      {active === 'timer' && <TimerView />}
      {active === 'tools' && <ToolsView />}
      {active === 'chatrooms' && <ChatroomsView />}
      {active === 'settings' && <SettingsView />}
    </AppShell>
  );
}
