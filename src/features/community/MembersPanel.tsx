import { Ban, Crown, MoreHorizontal, ShieldCheck, ShieldOff, Timer, TimerOff, UserMinus } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Avatar,
  Badge,
  Button,
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
import { MemberHover } from './MemberHover';
import { describeError } from './mapping';
import { can, canActOnMember, roleLabel } from './permissions';
import { TimeoutDialog } from './SafetyDialogs';
import { formatUntil, timeoutActive } from './safety';
import type { Community, Role } from './types';
import { useNow } from './typing';
import { getCommunityApi, useCommunityStore } from './useCommunityStore';

const ORDER: Role[] = ['admin', 'mod', 'member'];
const HEADINGS: Record<Role, string> = { admin: 'Admin', mod: 'Moderators', member: 'Members' };

export function MembersPanel({ community, onShowBans }: { community: Community; onShowBans?: () => void }) {
  const members = useCommunityStore((s) => s.members[community.id]) ?? [];
  const profiles = useCommunityStore((s) => s.profiles);
  const me = getCommunityApi().me;
  const [timeoutFor, setTimeoutFor] = useState<{ userId: string; name: string } | null>(null);

  // a "Timed out" badge disappears by itself when the time is up
  useNow(members.some((m) => timeoutActive(m.timeoutUntil, Date.now())));

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

  const makeAdmin = async (userId: string, name: string) => {
    const ok = await confirm({
      title: `Make ${name} the admin of ${community.name}?`,
      description: `${name} becomes the only admin and you become a moderator. You will lose the admin-only powers: managing channels and settings, appointing and removing moderators, banning moderators, and deleting the community. Only ${name} can give them back. This can’t be undone by you.`,
      confirmLabel: 'Transfer admin',
      destructive: true,
    });
    if (ok) await act(() => getCommunityApi().transferAdmin(community.id, userId), `${name} is now the admin`);
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
              const canTimeout = target !== null && canActOnMember(community.role, m.role, 'timeout');
              const canTransfer = target !== null && canActOnMember(community.role, m.role, 'transferAdmin');
              const timedOut = timeoutActive(m.timeoutUntil, Date.now());
              return (
                <li key={m.userId} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/50">
                  <MemberHover profile={m.profile} role={m.role} joinedAt={m.joinedAt} focusable side="left">
                    <span className="flex min-w-0 flex-1 items-center gap-2 rounded-sm">
                      <Avatar name={name} src={m.profile?.avatarUrl} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {name}
                          {m.userId === me && <span className="text-subtle-foreground"> (you)</span>}
                        </span>
                        {m.profile && <span className="block truncate text-[11px] text-subtle-foreground">@{m.profile.username}</span>}
                      </span>
                    </span>
                  </MemberHover>
                  {timedOut && m.timeoutUntil && (
                    <Badge tone="warning" title={`Timed out until ${formatUntil(m.timeoutUntil)}`}>
                      <Timer aria-hidden="true" /> Timed out
                    </Badge>
                  )}
                  {m.role !== 'member' && <Badge tone={m.role === 'admin' ? 'brand' : 'neutral'}>{roleLabel[m.role]}</Badge>}
                  {(canKick || canRole || canTimeout || canTransfer) && (
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
                        {canTransfer && (
                          <DropdownItem icon={<Crown />} onClick={() => void makeAdmin(m.userId, name)}>
                            Make admin…
                          </DropdownItem>
                        )}
                        {(canRole || canTransfer) && (canTimeout || canKick) && <DropdownSeparator />}
                        {canTimeout &&
                          (timedOut ? (
                            <DropdownItem
                              icon={<TimerOff />}
                              onClick={() => void act(() => getCommunityApi().timeoutMember(community.id, m.userId, 0), `${name}’s timeout was lifted`)}
                            >
                              Remove timeout
                            </DropdownItem>
                          ) : (
                            <DropdownItem icon={<Timer />} onClick={() => setTimeoutFor({ userId: m.userId, name })}>
                              Time out…
                            </DropdownItem>
                          ))}
                        {canTimeout && canKick && <DropdownSeparator />}
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
      {onShowBans && can(community.role, 'viewBans') && (
        <Button variant="ghost" size="sm" className="mt-auto justify-start text-muted-foreground" onClick={onShowBans}>
          <Ban /> Banned people
        </Button>
      )}
      <TimeoutDialog
        name={timeoutFor?.name ?? ''}
        open={timeoutFor !== null}
        onOpenChange={(o) => !o && setTimeoutFor(null)}
        onConfirm={async (seconds) => {
          if (!timeoutFor) return;
          await act(() => getCommunityApi().timeoutMember(community.id, timeoutFor.userId, seconds), `${timeoutFor.name} was timed out`);
        }}
      />
    </aside>
  );
}
