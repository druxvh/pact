import { Clock } from 'lucide-react';
import { PresenceBar } from '@/components/team/PresenceBar';

function greetingForHour(hour: number) {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function QuickHeader() {
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <header className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm text-slate-400">{greetingForHour(now.getHours())}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
          Office Hub Dashboard
        </h1>
        <p className="mt-1 inline-flex items-center gap-2 text-slate-300">
          <Clock className="h-4 w-4" />
          {time}
        </p>
      </div>
      <PresenceBar />
    </header>
  );
}
