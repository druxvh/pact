import { MessageCircle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { useUserStore } from '@/store/useUserStore';

export function RealtimeChat() {
  const teammates = useUserStore((state) => state.teammates);
  const messages = useUserStore((state) => state.messages);

  return (
    <Card
      title="Office Chat"
      action={<MessageCircle className="h-4 w-4 text-slate-400" />}
      className="min-h-64"
    >
      <ul className="space-y-3 text-sm">
        {messages.map((message) => {
          const author =
            teammates.find((user) => user.id === message.userId)?.displayName ??
            'Teammate';
          return (
            <li key={message.id} className="rounded-lg bg-slate-950/80 p-3">
              <p className="text-xs font-medium text-sky-400">{author}</p>
              <p className="mt-1 text-slate-200">{message.body}</p>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-xs text-slate-500">
        Realtime chat will connect through Supabase once env keys are set.
      </p>
    </Card>
  );
}
