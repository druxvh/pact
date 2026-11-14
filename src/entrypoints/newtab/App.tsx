import { AppShell } from '@/app/AppShell';
import { HomeView } from '@/features/home/HomeView';
import { NotesView } from '@/features/notes/NotesView';
import { KanbanView } from '@/features/kanban/KanbanView';
import { TimerView } from '@/features/timer/TimerView';
import { ToolsView } from '@/features/tools/ToolsView';
import { ChatroomsView } from '@/features/chat/ChatView';
import { PartyView } from '@/features/party/PartyView';
import { SettingsView } from '@/features/settings/SettingsView';
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
      {active === 'party' && <PartyView />}
      {active === 'settings' && <SettingsView />}
    </AppShell>
  );
}
