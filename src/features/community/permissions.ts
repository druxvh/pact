/**
 * Who may do what in a community. The database enforces the same rules (Row Level Security + triggers); this module is
 * what the UI uses to decide which buttons to show, so a button never appears for something the server would refuse.
 * Roles: `admin` (the one owner), `mod` (sub-admins the admin appoints), `member`.
 */
import type { Role } from './types';

export type Action =
  | 'post'
  | 'createInvite'
  | 'revokeInvite'
  | 'moderateMessages' // hide, restore, remove links
  | 'createChannel'
  | 'deleteChannel'
  | 'editCommunity'
  | 'deleteCommunity'
  | 'appointMods'
  | 'setSlowmode'
  | 'viewBans'
  | 'bypassSlowmode'
  | 'transferAdmin';

const ALLOWED: Record<Role, ReadonlySet<Action>> = {
  admin: new Set<Action>([
    'post',
    'createInvite',
    'revokeInvite',
    'moderateMessages',
    'createChannel',
    'deleteChannel',
    'editCommunity',
    'deleteCommunity',
    'appointMods',
    'setSlowmode',
    'viewBans',
    'bypassSlowmode',
    'transferAdmin',
  ]),
  mod: new Set<Action>(['post', 'createInvite', 'revokeInvite', 'moderateMessages', 'setSlowmode', 'viewBans', 'bypassSlowmode']),
  member: new Set<Action>(['post']),
};

export const can = (role: Role | null | undefined, action: Action): boolean => (role ? ALLOWED[role].has(action) : false);

export type MemberAction = 'kick' | 'ban' | 'setRole' | 'timeout' | 'transferAdmin';

/** Can `actor` do `action` to a member who currently has role `target`? (Never to the admin, never to yourself — callers check the latter.) */
export function canActOnMember(actor: Role, target: Role, action: MemberAction): boolean {
  if (target === 'admin') return false;
  if (action === 'setRole' || action === 'transferAdmin') return actor === 'admin';
  if (actor === 'admin') return true; // kick, ban or time out a mod or a member
  return actor === 'mod' && target === 'member';
}

/** Lifting a ban: the admin any, a moderator only the ones they issued (and never their own — they can't be moderating while banned). */
export const canUnban = (actor: Role, ban: { bannedBy: string | null; userId: string }, me: string): boolean =>
  ban.userId !== me && (actor === 'admin' || (actor === 'mod' && ban.bannedBy === me));

export const roleLabel: Record<Role, string> = { admin: 'Admin', mod: 'Moderator', member: 'Member' };
