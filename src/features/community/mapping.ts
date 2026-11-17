/** Row ↔ app-type mapping and error translation for the Supabase data layer (pure, so it is unit-tested). */
import {
  type Attachment,
  type Channel,
  CommunityError,
  type CommunityErrorCode,
  type CommunityMessage,
  type Invite,
  type Profile,
  type Reaction,
  type UnreadEntry,
} from './types';

type Row = Record<string, unknown>;
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null);

export function toAttachments(v: unknown): Attachment[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a): a is Row => typeof a === 'object' && a !== null && typeof (a as Row).path === 'string')
    .map((a) => ({
      path: a.path as string,
      name: str(a.name, 'file'),
      type: str(a.type, 'application/octet-stream'),
      size: typeof a.size === 'number' ? a.size : 0,
      ...(typeof a.width === 'number' && { width: a.width }),
      ...(typeof a.height === 'number' && { height: a.height }),
    }));
}

export function toMessage(r: Row): CommunityMessage {
  return {
    id: str(r.id),
    communityId: str(r.community_id),
    channelId: str(r.channel_id),
    authorId: str(r.author_id),
    body: str(r.body),
    attachments: toAttachments(r.attachments),
    replyTo: strOrNull(r.reply_to),
    createdAt: str(r.created_at),
    editedAt: strOrNull(r.edited_at),
    deletedAt: strOrNull(r.deleted_at),
    hiddenAt: strOrNull(r.hidden_at),
    hiddenBy: strOrNull(r.hidden_by),
    hiddenReason: str(r.hidden_reason),
    linksRemovedAt: strOrNull(r.links_removed_at),
  };
}

export const toChannel = (r: Row): Channel => ({ id: str(r.id), communityId: str(r.community_id), name: str(r.name), topic: str(r.topic) });
export const toProfile = (r: Row): Profile => ({ id: str(r.id), username: str(r.username), displayName: str(r.display_name), designation: str(r.designation) });
export const toReaction = (r: Row): Reaction => ({ messageId: str(r.message_id), userId: str(r.user_id), emoji: str(r.emoji) });
export const toInvite = (r: Row): Invite => ({
  code: str(r.code),
  maxUses: typeof r.max_uses === 'number' ? r.max_uses : null,
  uses: typeof r.uses === 'number' ? r.uses : 0,
  expiresAt: strOrNull(r.expires_at),
  createdAt: str(r.created_at),
  createdBy: str(r.created_by),
});

export const toUnread = (r: Row): UnreadEntry => ({
  channelId: str(r.channel_id),
  communityId: str(r.community_id),
  count: typeof r.unread === 'number' ? r.unread : Number(r.unread) || 0,
});

const KNOWN: CommunityErrorCode[] = ['rate_limited', 'banned', 'too_many_communities', 'community_limit', 'not_allowed', 'not_found'];

/** Turn whatever PostgREST / Storage / fetch threw into a CommunityError the UI can explain. */
export function toCommunityError(err: unknown): CommunityError {
  if (err instanceof CommunityError) return err;
  const e = (err ?? {}) as { message?: string; code?: string; status?: number; statusCode?: string | number };
  const message = typeof e.message === 'string' ? e.message : '';
  const known = KNOWN.find((k) => message === k || message.startsWith(`${k}:`));
  if (known) return new CommunityError(known);
  if (e.code === '42501' || e.status === 403 || e.statusCode === '403' || /row-level security|permission denied/i.test(message))
    return new CommunityError('not_allowed');
  if (e.code === 'PGRST116' || e.status === 404) return new CommunityError('not_found');
  if (e.code === '23505') return new CommunityError('unknown', 'That already exists.');
  if (e.code === '23514') return new CommunityError('unknown', 'That doesn’t fit the allowed limits.');
  if (/payload too large|exceeded the maximum/i.test(message) || e.status === 413 || e.statusCode === '413') return new CommunityError('too_large');
  if (/mime type|not supported/i.test(message)) return new CommunityError('bad_type');
  if (err instanceof TypeError || /failed to fetch|network/i.test(message)) return new CommunityError('network');
  return new CommunityError('unknown', message || undefined);
}

/** What to tell the person. */
export function describeError(err: unknown): string {
  const e = toCommunityError(err);
  switch (e.code) {
    case 'rate_limited':
      return 'Too many wrong codes. Wait a few minutes and try again.';
    case 'banned':
      return 'You can’t join this community.';
    case 'too_many_communities':
      return 'You’re in the maximum of 50 communities.';
    case 'community_limit':
      return 'You can create up to 10 communities.';
    case 'not_allowed':
      return 'You don’t have permission to do that.';
    case 'not_found':
      return 'That doesn’t exist any more.';
    case 'too_large':
      return 'That file is too big (25 MB max).';
    case 'not_configured':
      return 'GIF search isn’t set up on this server yet — you can still paste a GIF’s link or upload a file.';
    case 'bad_type':
      return 'That file type isn’t allowed. Use PNG, JPEG, GIF, WebP, MP4 or WebM.';
    case 'network':
      return 'Can’t reach the server. Check your connection.';
    default:
      return e.message && e.message !== 'unknown' ? e.message : 'Something went wrong.';
  }
}
