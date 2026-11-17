import { TypingDots } from '@/components/ui';
import { activeTypers, displayName, typingLabel, useNow } from './typing';
import { getCommunityApi, useCommunityStore } from './useCommunityStore';

/** "Ana is typing…" under the messages. Always occupies one line so the layout doesn't jump when someone starts or stops. */
export function TypingLine({ channelId }: { channelId: string }) {
  const map = useCommunityStore((s) => s.typing[channelId]);
  const profiles = useCommunityStore((s) => s.profiles);
  const now = useNow(!!map && Object.keys(map).length > 0);
  const ids = activeTypers(map, getCommunityApi().me, now);
  const label = typingLabel(ids.map((id) => displayName(profiles[id])));
  return (
    <div className="h-5 px-5 text-xs text-muted-foreground">
      {label && (
        <span className="inline-flex items-center gap-1.5">
          <TypingDots /> {label}
        </span>
      )}
    </div>
  );
}
