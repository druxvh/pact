export type Role = 'admin' | 'mod' | 'member';

export type Community = { id: string; name: string; description: string; hue: number; role: Role; createdAt: string };
export type Channel = { id: string; communityId: string; name: string; topic: string };
export type Profile = { id: string; username: string; displayName: string; designation: string };
export type Member = { userId: string; role: Role; joinedAt: string };

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
  | 'network'
  | 'unknown';
export class CommunityError extends Error {
  constructor(
    public code: CommunityErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const MESSAGE_MAX = 4000;
export const ATTACHMENTS_MAX = 6;
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm'] as const;
