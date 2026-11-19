import type { ReactElement } from 'react';
import { type ProfileCardData, ProfileHover } from '@/components/ProfileCard';
import { useListening } from '@/features/nowplaying/hooks';
import { roleLabel } from './permissions';
import type { Profile, Role } from './types';

/** "Joined Nov 2026" — or nothing, when the date isn't known. */
export function joinedLabel(iso: string | undefined): string | undefined {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? undefined : `Joined ${new Date(t).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;
}

/** What the hover card shows for a community member: their profile, a badge for admins and moderators (never for plain members) and when they joined. */
export function memberCard(profile: Profile, role?: Role, joinedAt?: string): ProfileCardData {
  return {
    name: profile.displayName || profile.username || 'Member',
    username: profile.username || undefined,
    role: profile.designation || undefined,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    links: profile.links,
    badge: role && role !== 'member' ? roleLabel[role] : undefined,
    meta: joinedLabel(joinedAt),
  };
}

const NOBODY: Profile = { id: '', username: '', displayName: '', designation: '' };

/**
 * Hover a person's avatar or name for their card. Wraps one element (rendered as the trigger, so layout and clicks are untouched);
 * while the profile hasn't loaded there is nothing to show, and it just stays quiet.
 */
export function MemberHover({
  profile,
  role,
  joinedAt,
  children,
  ...rest
}: {
  profile: Profile | undefined;
  role?: Role;
  joinedAt?: string;
  children: ReactElement<Record<string, unknown>>;
  /** Make the trigger a tab stop so keyboard users get the card too (names). */
  focusable?: boolean;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}) {
  const listening = useListening(profile?.id);
  return (
    <ProfileHover person={{ ...memberCard(profile ?? NOBODY, role, joinedAt), listening, userId: profile?.id }} disabled={!profile} {...rest}>
      {children}
    </ProfileHover>
  );
}
