import { useMemo } from 'react';
import { can } from './permissions';
import { slowmodeRemainingMs, timeoutActive } from './safety';
import { myMembership } from './store';
import type { Channel, Role } from './types';
import { useNow } from './typing';
import { getCommunityApi, useCommunityStore } from './useCommunityStore';

/** When my timeout in this community ends (ISO), or null if I'm not timed out. Re-renders by itself when it runs out. */
export function useMyTimeout(communityId: string): string | null {
  const me = getCommunityApi().me;
  const until = useCommunityStore((s) => myMembership(s, communityId, me)?.timeoutUntil ?? null);
  useNow(timeoutActive(until, Date.now())); // one render a second while it lasts, so the banner clears on time
  return timeoutActive(until, Date.now()) ? until : null;
}

/** How long (ms) I still have to wait before posting in this channel because of slowmode. Re-renders each second while waiting. */
export function useSlowmodeWait(channel: Channel | undefined, role: Role): number {
  const me = getCommunityApi().me;
  const messages = useCommunityStore((s) => (channel ? s.messages[channel.id] : undefined));
  const cooldownUntil = useCommunityStore((s) => (channel ? s.cooldownUntil[channel.id] : undefined));
  const lastOwnAt = useMemo(() => {
    for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) if (messages?.[i]?.authorId === me) return messages[i]?.createdAt ?? null;
    return null;
  }, [messages, me]);
  const wait = () =>
    slowmodeRemainingMs({ slowmodeSeconds: channel?.slowmodeSeconds ?? 0, exempt: can(role, 'bypassSlowmode'), lastOwnAt, cooldownUntil, now: Date.now() });
  useNow(wait() > 0);
  return wait();
}
