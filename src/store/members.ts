import { normalizeUsername, useUserStore } from '@/store/useUserStore';
import type { Person } from '@/types/user';

export type InviteResolution = { ok: false; msg: string } | { ok: true; msg: string; person: Person };

/**
 * Shared by notebooks and boards: validate "invite @username" against the
 * directory and the group's current members. Pure — callers apply the result.
 */
export function resolveInvite(memberIds: string[], rawUsername: string): InviteResolution {
  const clean = normalizeUsername(rawUsername);
  if (!clean) return { ok: false, msg: 'Enter a username' };
  const { teammates, currentUser } = useUserStore.getState();
  if (clean === currentUser.username) return { ok: false, msg: "You're already a member" };
  const person = teammates.find((t) => t.username.toLowerCase() === clean);
  if (!person) return { ok: false, msg: `No one called @${clean} in the demo directory` };
  if (memberIds.includes(person.id)) return { ok: false, msg: `@${person.username} is already a member` };
  return { ok: true, msg: `Added @${person.username}`, person };
}

/** Resolve member ids (incl. the current user) to people, preserving order. */
export function membersOf(memberIds: string[]): Person[] {
  const { teammates, currentUser } = useUserStore.getState();
  return memberIds
    .map((id) => (id === currentUser.id ? currentUser : teammates.find((t) => t.id === id)))
    .filter((p): p is Person => Boolean(p));
}
