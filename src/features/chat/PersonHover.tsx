import type { ReactElement } from 'react';
import { type ProfileCardData, ProfileHover } from '@/components/ProfileCard';
import { useListening } from '@/features/nowplaying/hooks';
import type { SocialLink } from '@/lib/socialLinks';
import type { Person } from '@/types/user';
import { DEMO_LINKS } from './demoLinks';

/** What the hover card shows for a person in Direct messages (a demo friend, or you). `designation` is the card's "role" line. */
export function personCard(p: Person): ProfileCardData {
  const links: SocialLink[] | undefined = p.links ?? DEMO_LINKS[p.id];
  return {
    name: p.displayName || p.username,
    username: p.username || undefined,
    role: p.designation || undefined,
    bio: p.bio || undefined,
    avatarUrl: p.avatarUrl,
    links,
  };
}

const NOBODY: Person = { id: '', displayName: '', username: '', designation: '', bio: '', email: '', isOnline: false };

/**
 * Hover a person's avatar or name for their card. Wraps one element (rendered as the trigger, so layout and clicks are untouched);
 * with no person (an unknown sender) it stays quiet.
 */
export function PersonHover({
  person,
  children,
  ...rest
}: {
  person: Person | undefined;
  children: ReactElement<Record<string, unknown>>;
  /** Make the trigger a tab stop so keyboard users get the card too (names; not things that are already buttons). */
  focusable?: boolean;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}) {
  const listening = useListening(person?.id);
  return (
    <ProfileHover person={{ ...personCard(person ?? NOBODY), listening, userId: person?.id }} disabled={!person} {...rest}>
      {children}
    </ProfileHover>
  );
}
