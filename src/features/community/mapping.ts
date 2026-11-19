/** Row ↔ app-type mapping and error translation for the Supabase data layer (pure, so it is unit-tested). */
import { sanitizeLinks } from '@/lib/socialLinks';
import { formatUntil, formatWait } from './safety';
import {
  type ActivityEvent,
  type Attachment,
  type Ban,
  type Channel,
  CommunityError,
  type CommunityErrorCode,
  type CommunityMessage,
  type Invite,
  type Member,
  type Profile,
  type Reaction,
  type Role,
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

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const asRole = (v: unknown): Role => (v === 'admin' || v === 'mod' ? v : 'member');

export const toChannel = (r: Row): Channel => ({
  id: str(r.id),
  communityId: str(r.community_id),
  name: str(r.name),
  topic: str(r.topic),
  slowmodeSeconds: Math.max(0, Math.floor(num(r.slowmode_seconds))), // older databases don't have the column
});
/**
 * `profiles.avatar_path` is a Storage path, never a URL; `resolveAvatar` turns it into the public URL (lib/supabase/avatar).
 * A database without the column (migration not applied yet) simply has no avatars. `links` is somebody else's input, so it goes
 * through the same validation as when it is saved (https, known hosts, at most five); a database without that column has none.
 */
export const toProfile = (r: Row, resolveAvatar?: (path: string) => string | undefined): Profile => {
  const avatar = resolveAvatar && typeof r.avatar_path === 'string' && r.avatar_path ? resolveAvatar(r.avatar_path) : undefined;
  const bio = str(r.bio).trim();
  const links = sanitizeLinks(r.links);
  return {
    id: str(r.id),
    username: str(r.username),
    displayName: str(r.display_name),
    designation: str(r.designation),
    ...(avatar && { avatarUrl: avatar }),
    ...(bio && { bio }),
    ...(links.length > 0 && { links }),
  };
};
export const toMember = (r: Row): Member => ({
  userId: str(r.user_id),
  role: asRole(r.role),
  joinedAt: str(r.joined_at),
  timeoutUntil: strOrNull(r.timeout_until),
});
export const toBan = (r: Row): Ban => ({ userId: str(r.user_id), bannedBy: strOrNull(r.banned_by), reason: str(r.reason), createdAt: str(r.created_at) });

/** A realtime INSERT payload on `messages` → what the activity feed needs (null if it isn't a usable row). */
export function toActivityEvent(r: Row): ActivityEvent | null {
  if (typeof r.id !== 'string' || typeof r.channel_id !== 'string' || typeof r.community_id !== 'string' || typeof r.author_id !== 'string') return null;
  return {
    messageId: r.id,
    communityId: r.community_id,
    channelId: r.channel_id,
    authorId: r.author_id,
    createdAt: str(r.created_at),
    body: str(r.body),
    replyTo: strOrNull(r.reply_to),
    hasAttachments: toAttachments(r.attachments).length > 0,
  };
}

/** Did the error say a column doesn't exist? (A database that hasn't had the latest migration applied yet.) */
export function isMissingColumn(err: unknown): boolean {
  const e = (err ?? {}) as { code?: string; message?: string };
  return e.code === '42703' || e.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(e.message ?? '');
}
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

const KNOWN: CommunityErrorCode[] = [
  'rate_limited',
  'banned',
  'too_many_communities',
  'community_limit',
  'channel_limit',
  'invite_limit',
  'reaction_limit',
  'slowmode',
  'timed_out',
  'bad_duration',
  'not_a_member',
  'not_allowed',
  'not_found',
];

/** Turn whatever PostgREST / Storage / fetch threw into a CommunityError the UI can explain. */
export function toCommunityError(err: unknown): CommunityError {
  if (err instanceof CommunityError) return err;
  const e = (err ?? {}) as { message?: string; code?: string; status?: number; statusCode?: string | number };
  const message = typeof e.message === 'string' ? e.message : '';
  const known = KNOWN.find((k) => message === k || message.startsWith(`${k}:`));
  if (known) {
    // `slowmode:<seconds to wait>` and `timed_out:<iso time it ends>` carry what the person needs to see.
    const rest = message.slice(known.length + 1);
    if (known === 'slowmode' && Number.isFinite(Number(rest)) && rest !== '') return new CommunityError(known, undefined, { seconds: Number(rest) });
    if (known === 'timed_out' && Number.isFinite(Date.parse(rest))) return new CommunityError(known, undefined, { until: rest });
    return new CommunityError(known);
  }
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
      return e.message && e.message !== 'banned' ? e.message : 'You can’t join this community.';
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
    case 'channel_limit':
      return 'A community can have up to 50 channels.';
    case 'invite_limit':
      return 'This community already has 50 open invites. Revoke some first.';
    case 'reaction_limit':
      return 'That message already has 20 different reactions.';
    case 'upload_limit':
      return 'You’ve reached the limit of 300 uploaded files in this community.';
    case 'slowmode':
      return e.detail?.seconds
        ? `Slowmode is on in this channel — you can send again in ${formatWait(e.detail.seconds)}.`
        : 'Slowmode is on in this channel — wait a moment before sending again.';
    case 'timed_out':
      return e.detail?.until
        ? `You’re timed out until ${formatUntil(e.detail.until)}. You can read, but not post or react.`
        : 'You’re timed out. You can read, but not post or react.';
    case 'bad_duration':
      return 'Choose a time out of up to 28 days.';
    case 'not_a_member':
      return 'That person isn’t in this community any more.';
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
