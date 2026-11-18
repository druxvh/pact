import type { SocialLink } from '@/lib/socialLinks';

export type Role = 'admin' | 'mod' | 'member';

export type Community = { id: string; name: string; description: string; hue: number; role: Role; createdAt: string };
/** `slowmodeSeconds`: the minimum gap between one member's messages here (0 = off; moderators are exempt). */
export type Channel = { id: string; communityId: string; name: string; topic: string; slowmodeSeconds: number };
/**
 * A member's public profile. `avatarUrl` is a public image URL, when the person has set one; `bio` and `links` (at most five,
 * already validated) are shown on the hover card. `designation` is what they do ("Designer"), not their community role.
 */
export type Profile = { id: string; username: string; displayName: string; designation: string; avatarUrl?: string; bio?: string; links?: SocialLink[] };
/** `timeoutUntil`: while in the future the member can read but not post or react (the server enforces it). */
export type Member = { userId: string; role: Role; joinedAt: string; timeoutUntil: string | null };
/** Someone banned from a community (only moderators can list these). */
export type Ban = { userId: string; bannedBy: string | null; reason: string; createdAt: string };

export type Attachment = { path: string; name: string; type: string; size: number; width?: number; height?: number };

export type CommunityMessage = {
  id: string;
  communityId: string;
  channelId: string;
  authorId: string;
  body: string;
  attachments: Attachment[];
  replyTo: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  hiddenAt: string | null;
  hiddenBy: string | null;
  hiddenReason: string;
  linksRemovedAt: string | null;
};

export type Reaction = { messageId: string; userId: string; emoji: string };

export type Invite = { code: string; maxUses: number | null; uses: number; expiresAt: string | null; createdAt: string; createdBy: string };
export type InvitePreview = { communityId: string; name: string; description: string; hue: number; members: number };

/** Unread messages in one channel (capped at 100 by the server, shown as "99+"). */
export type UnreadEntry = { channelId: string; communityId: string; count: number };
/** A new message somewhere in any of my communities (for unread badges and notifications). */
export type ActivityEvent = {
  messageId: string;
  communityId: string;
  channelId: string;
  authorId: string;
  createdAt: string;
  body: string;
  replyTo: string | null;
  hasAttachments: boolean;
};
export type TypingEvent = { channelId: string; userId: string };
/** One GIF from the search provider: `url` is what gets posted, `preview` a small version for the picker. */
export type Gif = { id: string; title: string; url: string; preview: string; width: number; height: number };
export type GifPage = { gifs: Gif[]; next: string | null };

export type LinkPreview = { url: string; title: string | null; description: string | null; site: string | null; image: string | null };

/** What happened on the server, as pushed to a viewer of one community. */
export type CommunityEvent =
  | { type: 'message'; message: CommunityMessage }
  | { type: 'reaction-added'; reaction: Reaction }
  | { type: 'reaction-removed'; reaction: Reaction }
  | { type: 'members-changed' }
  | { type: 'channels-changed' };

/** Failures the UI knows how to explain. */
export type CommunityErrorCode =
  | 'rate_limited'
  | 'banned'
  | 'too_many_communities'
  | 'community_limit'
  | 'not_allowed'
  | 'not_found'
  | 'too_large'
  | 'bad_type'
  | 'not_configured'
  | 'channel_limit'
  | 'invite_limit'
  | 'reaction_limit'
  | 'upload_limit'
  | 'slowmode'
  | 'timed_out'
  | 'bad_duration'
  | 'not_a_member'
  | 'network'
  | 'unknown';
/** What a `slowmode` / `timed_out` error carries: how long to wait, or when the timeout ends. */
export type CommunityErrorDetail = { seconds?: number; until?: string };
export class CommunityError extends Error {
  constructor(
    public code: CommunityErrorCode,
    message?: string,
    public detail?: CommunityErrorDetail,
  ) {
    super(message ?? code);
  }
}

export const MESSAGE_MAX = 4000;
export const ATTACHMENTS_MAX = 6;
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm'] as const;
