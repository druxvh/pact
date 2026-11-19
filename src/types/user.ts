import type { SocialLink } from '@/lib/socialLinks';

export type Person = {
  id: string;
  displayName: string;
  username: string;
  designation?: string;
  bio?: string;
  email?: string;
  avatarUrl?: string;
  /** Storage path of the profile picture (the source of `avatarUrl`). */
  avatarPath?: string;
  /** Up to five social links (see lib/socialLinks). */
  links?: SocialLink[];
  isOnline: boolean;
};

export type FriendRequest = {
  id: string;
  fromId: string;
  toId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
};
