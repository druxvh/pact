import { describe, expect, it } from 'vitest';
import { joinedLabel, memberCard } from './MemberHover';
import type { Profile } from './types';

const profile: Profile = {
  id: 'u',
  username: 'ann',
  displayName: 'Ann Lee',
  designation: 'Designer',
  bio: 'Pixels.',
  avatarUrl: 'https://cdn.test/a.webp',
  links: [{ kind: 'github', url: 'https://github.com/ann' }],
};

describe('member hover card data', () => {
  it('maps the profile: name, @username, designation as the role line, bio, avatar and links', () => {
    expect(memberCard(profile)).toMatchObject({
      name: 'Ann Lee',
      username: 'ann',
      role: 'Designer',
      bio: 'Pixels.',
      avatarUrl: 'https://cdn.test/a.webp',
      links: [{ kind: 'github', url: 'https://github.com/ann' }],
    });
  });

  it('the badge is the community role for admins and moderators, never for plain members or when unknown', () => {
    expect(memberCard(profile, 'admin').badge).toBe('Admin');
    expect(memberCard(profile, 'mod').badge).toBe('Moderator');
    expect(memberCard(profile, 'member').badge).toBeUndefined();
    expect(memberCard(profile).badge).toBeUndefined();
  });

  it('"Joined <Mon YYYY>" only when the date is known and valid', () => {
    const label = joinedLabel('2026-11-18T09:30:00Z');
    expect(label).toMatch(/^Joined [A-Z][a-z]{2} 2026$/);
    expect(memberCard(profile, 'member', '2026-11-18T09:30:00Z').meta).toBe(label);
    expect(joinedLabel(undefined)).toBeUndefined();
    expect(joinedLabel('')).toBeUndefined();
    expect(joinedLabel('not a date')).toBeUndefined();
    expect(memberCard(profile).meta).toBeUndefined();
  });

  it('falls back to the username when there is no display name, and leaves empty parts out', () => {
    const bare = memberCard({ id: 'u', username: 'zed', displayName: '', designation: '' });
    expect(bare.name).toBe('zed');
    expect(bare.role).toBeUndefined();
    expect(bare.bio).toBeUndefined();
    expect(bare.links).toBeUndefined();
  });
});
