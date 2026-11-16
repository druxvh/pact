import { Ban, MoreHorizontal, ShieldCheck, ShieldOff, UserMinus } from 'lucide-react';
import { useMemo } from 'react';
import {
  Avatar,
  Badge,
  confirm,
  DropdownContent,
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
  DropdownTrigger,
  IconButton,
  promptText,
} from '@/components/ui';
import { notify } from '@/lib/toast';
import { describeError } from './mapping';
import { canActOnMember, roleLabel } from './permissions';
import type { Community, Role } from './types';
import { getCommunityApi, useCommunityStore } from './useCommunityStore';

const ORDER: Role[] = ['admin', 'mod', 'member'];
const HEADINGS: Record<Role, string> = { admin: 'Admin', mod: 'Moderators', member: 'Members' };

export function MembersPanel({ community }: { community: Community }) {
  const members = useCommunityStore((s) => s.members[community.id]) ?? [];
  const profiles = useCommunityStore((s) => s.profiles);
  const me = getCommunityApi().me;

  const groups = useMemo(
    () =>
      ORDER.map((role) => ({
        role,
        people: members
          .filter((m) => m.role === role)
          .map((m) => ({ ...m, profile: profiles[m.userId] }))
          .sort((a, b) => (a.profile?.displayName ?? '').localeCompare(b.profile?.displayName ?? '')),
      })).filter((g) => g.people.length > 0),
    [members, profiles],
  );

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      await useCommunityStore.getState().refreshMembers();
      notify.success(done);
    } catch (err) {
      notify.error('That didn’t work', describeError(err));
    }
  };

  return (
    <aside aria-label="Members" className="hidden w-56 shrink-0 flex-col overflow-y-auto border-l p-2 lg:flex">
      {groups.map((g) => (
        <div key={g.role} className="mb-3">
          <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">
            {HEADINGS[g.role]} — {g.people.length}
          </p>
          <ul>
            {g.people.map((m) => {
              const name = m.profile?.displayName || m.profile?.username || 'Member';
              const target = m.userId !== me ? m.role : null;
              const canKick = target !== null && canActOnMember(community.role, m.role, 'kick');
              const canRole = target !== null && canActOnMember(community.role, m.role, 'setRole');
              return (
                <li key={m.userId} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/50">
                  <Avatar name={name} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {name}
                      {m.userId === me && <span className="text-subtle-foreground"> (you)</span>}
                    </span>
                    {m.profile && <span className="block truncate text-[11px] text-subtle-foreground">@{m.profile.username}</span>}
                  </span>
                  {m.role !== 'member' && <Badge tone={m.role === 'admin' ? 'brand' : 'neutral'}>{roleLabel[m.role]}</Badge>}
                  {(canKick || canRole) && (
                    <DropdownMenu>
                      <DropdownTrigger
                        render={
                          <IconButton label={`Actions for ${name}`} size="icon-xs" className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100" />
                        }
                      >
                        <MoreHorizontal />
                      </DropdownTrigger>
                      <DropdownContent className="w-52">
                        {canRole &&
                          (m.role === 'mod' ? (
                            <DropdownItem
                              icon={<ShieldOff />}
                              onClick={() => void act(() => getCommunityApi().setRole(community.id, m.userId, 'member'), `${name} is no longer a moderator`)}
                            >
                              Remove as moderator
                            </DropdownItem>
                          ) : (
                            <DropdownItem
                              icon={<ShieldCheck />}
                              onClick={() => void act(() => getCommunityApi().setRole(community.id, m.userId, 'mod'), `${name} is now a moderator`)}
                            >
                              Make moderator
                            </DropdownItem>
                          ))}
                        {canKick && canRole && <DropdownSeparator />}
                        {canKick && (
                          <>
                            <DropdownItem
                              icon={<UserMinus />}
                              destructive
                              onClick={async () => {
                                if (
                                  await confirm({
                                    title: `Remove ${name}?`,
                                    description: 'They can rejoin with a new invite.',
                                    confirmLabel: 'Remove',
                                    destructive: true,
                                  })
                                ) {
                                  void act(() => getCommunityApi().kickMember(community.id, m.userId), `${name} was removed`);
                                }
                              }}
                            >
                              Remove from community
                            </DropdownItem>
                            <DropdownItem
                              icon={<Ban />}
                              destructive
                              onClick={async () => {
                                const reason = await promptText({
                                  title: `Ban ${name}?`,
                                  description: 'They’re removed and can’t rejoin, even with an invite.',
                                  label: 'Reason (optional)',
                                  maxLength: 200,
                                  confirmLabel: 'Ban',
                                });
                                if (reason !== null) void act(() => getCommunityApi().banMember(community.id, m.userId, reason), `${name} was banned`);
                              }}
                            >
                              Ban
                            </DropdownItem>
                          </>
                        )}
                      </DropdownContent>
                    </DropdownMenu>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </aside>
  );
}
