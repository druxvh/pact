import { useUserStore } from '@/store/useUserStore';

export function PresenceBar() {
  const teammates = useUserStore((state) => state.teammates);
  const onlineCount = teammates.filter((user) => user.isOnline).length;

  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-2">
        {teammates.map((user) => (
          <span
            key={user.id}
            title={user.displayName}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-slate-900 bg-slate-700 text-xs font-semibold"
          >
            {user.displayName.slice(0, 1)}
            <span
              className={`absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full ${
                user.isOnline ? 'bg-emerald-400' : 'bg-slate-500'
              }`}
            />
          </span>
        ))}
      </div>
      <p className="text-sm text-slate-400">
        {onlineCount} online
      </p>
    </div>
  );
}
