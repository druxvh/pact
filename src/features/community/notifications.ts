/**
 * What the app-wide community activity feed does with a new message: how it is described, who it is "for", and where a
 * notification takes you. Pure helpers plus the small interface the store uses to reach the rest of the app (so the store
 * stays testable without the notification centre or toasts).
 */
import { gifUrl } from './links';

/** A notification entry the store wants shown in the notification centre. */
export type CommunityNotice = {
  /** One entry per key: a later notice with the same key replaces it. */
  key: string;
  title: string;
  body: string;
  /** Where clicking it goes (`#/chat/<sub>`). */
  sub: string;
};

/** How the store reaches the notification centre and toasts. */
export type NotificationSink = {
  upsert(notice: CommunityNotice): void;
  /** The person has seen these: mark every entry whose key starts with `keyPrefix` as read. */
  resolve(keyPrefix: string): void;
  /** A transient toast with an "Open" action going to `sub` (only used for replies to me and @mentions). */
  toast(t: { title: string; body: string; sub: string }): void;
};

export const noopSink: NotificationSink = { upsert: () => {}, resolve: () => {}, toast: () => {} };

/** Notification keys: everything about one community starts with `chat:<community>:`, one channel with `…:<channel>`. */
export const communityKey = (communityId: string) => `chat:${communityId}:`;
export const channelKey = (communityId: string, channelId: string) => `${communityKey(communityId)}${channelId}`;
export const mentionKey = (communityId: string, channelId: string, messageId: string) => `${channelKey(communityId, channelId)}:m:${messageId}`;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const LINK_RE = new RegExp(`^c:(${UUID}):(${UUID})$`, 'i');

/** `#/chat/c:<community>:<channel>` — opens that channel in the Communities tab. */
export const communityLink = (communityId: string, channelId: string) => `c:${communityId}:${channelId}`;
export function communityLinkFromSub(sub: string | null | undefined): { communityId: string; channelId: string } | null {
  const m = sub ? LINK_RE.exec(sub) : null;
  return m ? { communityId: (m[1] as string).toLowerCase(), channelId: (m[2] as string).toLowerCase() } : null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does a message @mention this username? (Case-insensitive; `@ann` doesn't match `@anna`, nor an email's `@host`.) */
export function mentionsUser(body: string, username: string | undefined | null): boolean {
  if (!username || !body.includes('@')) return false;
  return new RegExp(`(^|[^a-z0-9_@])@${escapeRe(username)}(?![a-z0-9_])`, 'i').test(body);
}

/** One line describing a message in a notification: "Ana: see you at 5", "Ana sent a GIF". */
export function describeMessage(author: string, body: string, hasAttachments: boolean, max = 90): string {
  const t = body.trim();
  if (!t) return `${author} ${hasAttachments ? 'sent an attachment' : 'sent a message'}`;
  if (gifUrl(t)) return `${author} sent a GIF`;
  const flat = t.replace(/\s+/g, ' ');
  return `${author}: ${flat.length > max ? `${flat.slice(0, max - 1)}…` : flat}`;
}

/** The Chat nav badge's community part: unread everywhere except in muted communities. */
export function totalCommunityUnread(unread: Record<string, { communityId: string; count: number }>, muted: Record<string, true>): number {
  let n = 0;
  for (const u of Object.values(unread)) if (!muted[u.communityId]) n += u.count;
  return n;
}
