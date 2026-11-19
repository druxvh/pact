import type {
  ActivityEvent,
  Attachment,
  Ban,
  Channel,
  Community,
  CommunityEvent,
  CommunityMessage,
  GifPage,
  Invite,
  InvitePreview,
  LinkPreview,
  Member,
  Profile,
  Reaction,
  Role,
  TypingEvent,
  UnreadEntry,
} from './types';

/** Handle for announcing "I'm typing" on one community's live typing channel. */
export type TypingChannel = { announce(channelId: string): void; stop(): void };

/**
 * Everything the Communities UI needs from a backend. `supabaseApi` is the real thing; `memoryApi` is a faithful
 * in-memory stand-in used by tests and the dev harness. Methods reject with `CommunityError` for expected failures.
 */
export interface CommunityApi {
  /** The signed-in user's id. */
  readonly me: string;

  listCommunities(): Promise<Community[]>;
  createCommunity(input: { name: string; description: string; hue: number }): Promise<string>;
  updateCommunity(id: string, patch: { name?: string; description?: string }): Promise<void>;
  deleteCommunity(id: string): Promise<void>;
  leaveCommunity(id: string): Promise<void>;

  previewInvite(code: string): Promise<InvitePreview | null>;
  /** Returns the community id, or null if the code is unknown, expired or used up. */
  joinCommunity(code: string): Promise<string | null>;
  listInvites(communityId: string): Promise<Invite[]>;
  createInvite(communityId: string, opts: { maxUses: number | null; expiresInHours: number | null }): Promise<Invite>;
  revokeInvite(code: string): Promise<void>;

  listChannels(communityId: string): Promise<Channel[]>;
  createChannel(communityId: string, name: string, topic: string): Promise<Channel>;
  deleteChannel(channelId: string): Promise<void>;
  /** Moderators and the admin. `seconds` is 0 (off) to 21600; moderators are never slowed themselves. */
  setSlowmode(channelId: string, seconds: number): Promise<Channel>;

  listMembers(communityId: string): Promise<Member[]>;
  getProfiles(ids: string[]): Promise<Profile[]>;
  setRole(communityId: string, userId: string, role: Exclude<Role, 'admin'>): Promise<void>;
  kickMember(communityId: string, userId: string): Promise<void>;
  banMember(communityId: string, userId: string, reason: string): Promise<void>;
  /** Moderators and the admin. Newest first. */
  listBans(communityId: string): Promise<Ban[]>;
  /** The admin lifts any ban; a moderator only the ones they issued. */
  unbanMember(communityId: string, userId: string): Promise<void>;
  /**
   * Time a member out for `seconds` (1 s – 28 days), or lift it with 0. They can still read, but not post or react.
   * The admin may time out moderators and members, a moderator only members; never the admin or yourself.
   * Returns when it ends (null when lifted).
   */
  timeoutMember(communityId: string, userId: string, seconds: number): Promise<string | null>;
  /** The admin only: `userId` (a current member) becomes the admin and you become a moderator. */
  transferAdmin(communityId: string, userId: string): Promise<void>;
  /** Who wrote a message (null if you can't see it) — to tell whether a new message is a reply to you. */
  getMessageAuthor(messageId: string): Promise<string | null>;

  /** Newest first. `before` is the oldest message you already have: the page continues strictly before it, by (time, id). */
  listMessages(channelId: string, opts: { before?: { createdAt: string; id: string }; limit: number }): Promise<CommunityMessage[]>;
  sendMessage(input: { communityId: string; channelId: string; body: string; attachments: Attachment[]; replyTo: string | null }): Promise<CommunityMessage>;
  editMessage(id: string, body: string): Promise<CommunityMessage>;
  deleteMessage(id: string): Promise<CommunityMessage>;
  hideMessage(id: string, reason: string): Promise<CommunityMessage>;
  restoreMessage(id: string): Promise<CommunityMessage>;
  stripLinks(id: string): Promise<CommunityMessage>;
  /** Mods only: what a hidden / link-stripped message originally said. */
  getOriginal(id: string): Promise<{ body: string; attachments: Attachment[] } | null>;

  listReactions(messageIds: string[]): Promise<Reaction[]>;
  addReaction(message: { id: string; communityId: string }, emoji: string): Promise<void>;
  removeReaction(messageId: string, emoji: string): Promise<void>;

  uploadAttachment(communityId: string, file: File): Promise<Attachment>;
  /** A temporary URL for a member-only file. */
  attachmentUrl(path: string): Promise<string | null>;
  fetchLinkPreview(url: string): Promise<LinkPreview | null>;

  /** Channels with unread messages (never includes your own messages). */
  unreadCounts(): Promise<UnreadEntry[]>;
  /** Remember that you have seen everything in the channel up to `upTo` (the createdAt of the newest message you saw). */
  markRead(channel: { id: string; communityId: string }, upTo: string): Promise<void>;
  /** New messages in any community you belong to. Returns the unsubscribe function. */
  subscribeActivity(onMessage: (e: ActivityEvent) => void): () => void;
  /** Ephemeral "is typing" signals from the other members of one community (never stored). */
  subscribeTyping(communityId: string, onTyping: (e: TypingEvent) => void): TypingChannel;

  /** Search GIFs (an empty query means "trending"). Rejects with `not_configured` when the server has no GIF provider key. */
  searchGifs(query: string, opts?: { next?: string | null }): Promise<GifPage>;

  /** Live updates for one community. Returns the unsubscribe function. */
  subscribe(communityId: string, onEvent: (e: CommunityEvent) => void): () => void;
}
