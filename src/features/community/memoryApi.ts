/**
 * An in-memory "server" + per-user API that follows the same rules as supabase/migrations/…_communities.sql.
 * Used by unit tests and the dev harness (never shipped), so the store and UI can be exercised with several people
 * (admin, moderator, member) without a database.
 */
import type { CommunityApi } from './api';
import { can, canActOnMember } from './permissions';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  type Attachment,
  type Channel,
  type Community,
  CommunityError,
  type CommunityEvent,
  type CommunityMessage,
  type Invite,
  type Member,
  type Profile,
  type Reaction,
  type Role,
} from './types';

type Sub = { userId: string; communityId: string; cb: (e: CommunityEvent) => void };
type Stored = { id: string; name: string; description: string; hue: number; createdBy: string; createdAt: string };
type Original = { body: string; attachments: Attachment[] };

const code16 = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');

export class MemoryServer {
  users = new Map<string, Profile>();
  communities: Stored[] = [];
  members: Array<{ communityId: string; userId: string; role: Role; joinedAt: string }> = [];
  bans: Array<{ communityId: string; userId: string }> = [];
  channels: Channel[] = [];
  invites: Array<Invite & { communityId: string }> = [];
  messages: CommunityMessage[] = [];
  originals = new Map<string, Original>();
  reactions: Array<Reaction & { communityId: string }> = [];
  files = new Map<string, string>();
  failedInvites = new Map<string, number>();
  subs = new Set<Sub>();
  private last = 0;
  /** Strictly increasing, like the database's microsecond timestamps: two writes never share a time. */
  clock = () => {
    this.last = Math.max(Date.now(), this.last + 1);
    return new Date(this.last).toISOString();
  };

  addUser(username: string, displayName = username): string {
    const id = crypto.randomUUID();
    this.users.set(id, { id, username, displayName, designation: '' });
    return id;
  }

  roleOf(cid: string, uid: string): Role | null {
    return this.members.find((m) => m.communityId === cid && m.userId === uid)?.role ?? null;
  }

  emit(cid: string, e: CommunityEvent) {
    for (const s of this.subs) if (s.communityId === cid && this.roleOf(cid, s.userId)) s.cb(e);
  }

  api(me: string): CommunityApi {
    return new MemoryApi(this, me);
  }
}

class MemoryApi implements CommunityApi {
  constructor(
    private s: MemoryServer,
    readonly me: string,
  ) {}

  private role(cid: string) {
    return this.s.roleOf(cid, this.me);
  }
  private need(cid: string, action: Parameters<typeof can>[1]) {
    if (!can(this.role(cid), action)) throw new CommunityError('not_allowed');
  }
  private message(id: string): CommunityMessage {
    const m = this.s.messages.find((x) => x.id === id);
    if (!m || !this.role(m.communityId)) throw new CommunityError('not_found');
    return m;
  }

  async listCommunities(): Promise<Community[]> {
    return this.s.communities
      .filter((c) => this.role(c.id))
      .map((c) => ({ id: c.id, name: c.name, description: c.description, hue: c.hue, role: this.role(c.id) as Role, createdAt: c.createdAt }));
  }

  async createCommunity(input: { name: string; description: string; hue: number }): Promise<string> {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 60) throw new CommunityError('unknown', 'Name must be 2–60 characters.');
    if (this.s.communities.filter((c) => c.createdBy === this.me).length >= 10) throw new CommunityError('community_limit');
    const id = crypto.randomUUID();
    this.s.communities.push({ id, name, description: input.description, hue: input.hue, createdBy: this.me, createdAt: this.s.clock() });
    this.s.members.push({ communityId: id, userId: this.me, role: 'admin', joinedAt: this.s.clock() });
    this.s.channels.push({ id: crypto.randomUUID(), communityId: id, name: 'general', topic: 'Say hi 👋' });
    return id;
  }

  async updateCommunity(id: string, patch: { name?: string; description?: string }) {
    this.need(id, 'editCommunity');
    const c = this.s.communities.find((x) => x.id === id);
    if (c)
      Object.assign(c, {
        ...(patch.name !== undefined && { name: patch.name.trim() }),
        ...(patch.description !== undefined && { description: patch.description }),
      });
  }

  async deleteCommunity(id: string) {
    this.need(id, 'deleteCommunity');
    this.s.communities = this.s.communities.filter((c) => c.id !== id);
    this.s.members = this.s.members.filter((m) => m.communityId !== id);
    this.s.channels = this.s.channels.filter((c) => c.communityId !== id);
    this.s.messages = this.s.messages.filter((m) => m.communityId !== id);
    this.s.invites = this.s.invites.filter((i) => i.communityId !== id);
  }

  async leaveCommunity(id: string) {
    if (this.role(id) === 'admin') throw new CommunityError('not_allowed', 'The admin can’t leave; delete the community instead.');
    this.s.members = this.s.members.filter((m) => !(m.communityId === id && m.userId === this.me));
    this.s.emit(id, { type: 'members-changed' });
  }

  private throttle() {
    if ((this.s.failedInvites.get(this.me) ?? 0) >= 15) throw new CommunityError('rate_limited');
  }
  private usable(code: string) {
    const i = this.s.invites.find((x) => x.code === code.trim().toLowerCase());
    if (!i || (i.expiresAt && Date.parse(i.expiresAt) <= Date.now()) || (i.maxUses !== null && i.uses >= i.maxUses)) return null;
    return i;
  }

  async previewInvite(code: string) {
    this.throttle();
    const i = this.usable(code);
    const c = i && this.s.communities.find((x) => x.id === i.communityId);
    if (!i || !c || this.s.bans.some((b) => b.communityId === c.id && b.userId === this.me)) {
      this.s.failedInvites.set(this.me, (this.s.failedInvites.get(this.me) ?? 0) + 1);
      return null;
    }
    return { communityId: c.id, name: c.name, description: c.description, hue: c.hue, members: this.s.members.filter((m) => m.communityId === c.id).length };
  }

  async joinCommunity(code: string) {
    this.throttle();
    const raw = this.s.invites.find((x) => x.code === code.trim().toLowerCase());
    const i = this.usable(code);
    if (!i) {
      if (raw && this.role(raw.communityId)) return raw.communityId;
      this.s.failedInvites.set(this.me, (this.s.failedInvites.get(this.me) ?? 0) + 1);
      return null;
    }
    if (this.s.bans.some((b) => b.communityId === i.communityId && b.userId === this.me)) throw new CommunityError('banned');
    if (this.role(i.communityId)) return i.communityId;
    this.s.members.push({ communityId: i.communityId, userId: this.me, role: 'member', joinedAt: this.s.clock() });
    i.uses++;
    this.s.emit(i.communityId, { type: 'members-changed' });
    return i.communityId;
  }

  async listInvites(cid: string) {
    this.need(cid, 'createInvite');
    return this.s.invites.filter((i) => i.communityId === cid).map(({ communityId: _c, ...i }) => i);
  }
  async createInvite(cid: string, opts: { maxUses: number | null; expiresInHours: number | null }) {
    this.need(cid, 'createInvite');
    const inv = {
      code: code16(),
      communityId: cid,
      maxUses: opts.maxUses,
      uses: 0,
      expiresAt: opts.expiresInHours ? new Date(Date.now() + opts.expiresInHours * 3_600_000).toISOString() : null,
      createdAt: this.s.clock(),
      createdBy: this.me,
    };
    this.s.invites.push(inv);
    const { communityId: _c, ...out } = inv;
    return out;
  }
  async revokeInvite(code: string) {
    const i = this.s.invites.find((x) => x.code === code);
    if (!i) return;
    this.need(i.communityId, 'revokeInvite');
    this.s.invites = this.s.invites.filter((x) => x.code !== code);
  }

  async listChannels(cid: string) {
    if (!this.role(cid)) throw new CommunityError('not_found');
    return this.s.channels.filter((c) => c.communityId === cid);
  }
  async createChannel(cid: string, name: string, topic: string) {
    this.need(cid, 'createChannel');
    if (!/^[a-z0-9][a-z0-9-]{0,29}$/.test(name)) throw new CommunityError('unknown', 'Channel names are lowercase letters, numbers and dashes.');
    if (this.s.channels.some((c) => c.communityId === cid && c.name === name)) throw new CommunityError('unknown', 'That channel already exists.');
    const ch = { id: crypto.randomUUID(), communityId: cid, name, topic };
    this.s.channels.push(ch);
    this.s.emit(cid, { type: 'channels-changed' });
    return ch;
  }
  async deleteChannel(id: string) {
    const ch = this.s.channels.find((c) => c.id === id);
    if (!ch) return;
    this.need(ch.communityId, 'deleteChannel');
    this.s.channels = this.s.channels.filter((c) => c.id !== id);
    this.s.messages = this.s.messages.filter((m) => m.channelId !== id);
    this.s.emit(ch.communityId, { type: 'channels-changed' });
  }

  async listMembers(cid: string): Promise<Member[]> {
    if (!this.role(cid)) throw new CommunityError('not_found');
    return this.s.members.filter((m) => m.communityId === cid).map(({ communityId: _c, ...m }) => m);
  }
  async getProfiles(ids: string[]) {
    return ids.map((id) => this.s.users.get(id)).filter((p): p is Profile => !!p);
  }
  async setRole(cid: string, userId: string, role: Exclude<Role, 'admin'>) {
    const target = this.s.members.find((m) => m.communityId === cid && m.userId === userId);
    const mine = this.role(cid);
    if (!target || !mine || userId === this.me || !canActOnMember(mine, target.role, 'setRole')) throw new CommunityError('not_allowed');
    target.role = role;
    this.s.emit(cid, { type: 'members-changed' });
  }
  async kickMember(cid: string, userId: string) {
    const target = this.s.members.find((m) => m.communityId === cid && m.userId === userId);
    const mine = this.role(cid);
    if (!target || !mine || userId === this.me || !canActOnMember(mine, target.role, 'kick')) throw new CommunityError('not_allowed');
    this.s.members = this.s.members.filter((m) => m !== target);
    this.s.emit(cid, { type: 'members-changed' });
  }
  async banMember(cid: string, userId: string, _reason: string) {
    const target = this.s.members.find((m) => m.communityId === cid && m.userId === userId);
    const mine = this.role(cid);
    if (!mine || userId === this.me || (target && !canActOnMember(mine, target.role, 'ban')) || !can(mine, 'moderateMessages'))
      throw new CommunityError('not_allowed');
    this.s.bans.push({ communityId: cid, userId });
    if (target) this.s.members = this.s.members.filter((m) => m !== target);
    this.s.emit(cid, { type: 'members-changed' });
  }

  async listMessages(channelId: string, opts: { before?: { createdAt: string; id: string }; limit: number }) {
    const ch = this.s.channels.find((c) => c.id === channelId);
    if (!ch || !this.role(ch.communityId)) throw new CommunityError('not_found');
    return this.s.messages
      .filter(
        (m) =>
          m.channelId === channelId &&
          (!opts.before || m.createdAt < opts.before.createdAt || (m.createdAt === opts.before.createdAt && m.id < opts.before.id)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, opts.limit)
      .map((m) => ({ ...m }));
  }

  async sendMessage(input: { communityId: string; channelId: string; body: string; attachments: Attachment[]; replyTo: string | null }) {
    this.need(input.communityId, 'post');
    if (!input.body.trim() && input.attachments.length === 0) throw new CommunityError('unknown', 'Say something or attach a file.');
    if (input.body.length > 4000 || input.attachments.length > 6) throw new CommunityError('too_large');
    if (input.attachments.some((a) => !a.path.startsWith(`${input.communityId}/`))) throw new CommunityError('not_allowed');
    if (input.replyTo && !this.s.messages.some((m) => m.id === input.replyTo && m.channelId === input.channelId)) throw new CommunityError('not_found');
    const m: CommunityMessage = {
      id: crypto.randomUUID(),
      communityId: input.communityId,
      channelId: input.channelId,
      authorId: this.me,
      body: input.body.trim(),
      attachments: input.attachments,
      replyTo: input.replyTo,
      createdAt: this.s.clock(),
      editedAt: null,
      deletedAt: null,
      hiddenAt: null,
      hiddenBy: null,
      hiddenReason: '',
      linksRemovedAt: null,
    };
    this.s.messages.push(m);
    this.s.emit(m.communityId, { type: 'message', message: { ...m } });
    return { ...m };
  }

  private changed(m: CommunityMessage) {
    this.s.emit(m.communityId, { type: 'message', message: { ...m } });
    return { ...m };
  }
  async editMessage(id: string, body: string) {
    const m = this.message(id);
    if (m.authorId !== this.me || m.hiddenAt || m.deletedAt || m.linksRemovedAt || !body.trim()) throw new CommunityError('not_allowed');
    m.body = body.trim();
    m.editedAt = this.s.clock();
    return this.changed(m);
  }
  async deleteMessage(id: string) {
    const m = this.message(id);
    if (m.authorId !== this.me) throw new CommunityError('not_allowed');
    m.deletedAt = this.s.clock();
    m.body = '';
    m.attachments = [];
    return this.changed(m);
  }
  async hideMessage(id: string, reason: string) {
    const m = this.message(id);
    this.need(m.communityId, 'moderateMessages');
    if (!m.hiddenAt) {
      if (!this.s.originals.has(id)) this.s.originals.set(id, { body: m.body, attachments: m.attachments });
      m.hiddenAt = this.s.clock();
      m.hiddenBy = this.me;
      m.hiddenReason = reason.slice(0, 200);
      m.body = '';
      m.attachments = [];
    }
    return this.changed(m);
  }
  async restoreMessage(id: string) {
    const m = this.message(id);
    this.need(m.communityId, 'moderateMessages');
    const o = this.s.originals.get(id);
    if (m.hiddenAt && o) {
      m.body = o.body;
      m.attachments = o.attachments;
      this.s.originals.delete(id);
    }
    m.hiddenAt = null;
    m.hiddenBy = null;
    m.hiddenReason = '';
    return this.changed(m);
  }
  async stripLinks(id: string) {
    const m = this.message(id);
    this.need(m.communityId, 'moderateMessages');
    if (!m.linksRemovedAt) {
      if (!this.s.originals.has(id)) this.s.originals.set(id, { body: m.body, attachments: m.attachments });
      m.body = m.body.replace(/(https?:\/\/|www\.)\S+/gi, '[link removed]');
      m.linksRemovedAt = this.s.clock();
    }
    return this.changed(m);
  }
  async getOriginal(id: string) {
    const m = this.message(id);
    this.need(m.communityId, 'moderateMessages');
    return this.s.originals.get(id) ?? null;
  }

  async listReactions(messageIds: string[]): Promise<Reaction[]> {
    return this.s.reactions.filter((r) => messageIds.includes(r.messageId) && this.role(r.communityId)).map(({ communityId: _c, ...r }) => r);
  }
  async addReaction(message: { id: string; communityId: string }, emoji: string) {
    this.need(message.communityId, 'post');
    if (!this.s.reactions.some((r) => r.messageId === message.id && r.userId === this.me && r.emoji === emoji)) {
      this.s.reactions.push({ messageId: message.id, communityId: message.communityId, userId: this.me, emoji });
      this.s.emit(message.communityId, { type: 'reaction-added', reaction: { messageId: message.id, userId: this.me, emoji } });
    }
  }
  async removeReaction(messageId: string, emoji: string) {
    const r = this.s.reactions.find((x) => x.messageId === messageId && x.userId === this.me && x.emoji === emoji);
    if (!r) return;
    this.s.reactions = this.s.reactions.filter((x) => x !== r);
    this.s.emit(r.communityId, { type: 'reaction-removed', reaction: { messageId, userId: this.me, emoji } });
  }

  async uploadAttachment(cid: string, file: File): Promise<Attachment> {
    this.need(cid, 'post');
    if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) throw new CommunityError('bad_type');
    if (file.size > ATTACHMENT_MAX_BYTES) throw new CommunityError('too_large');
    const path = `${cid}/${this.me}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
    this.s.files.set(path, URL.createObjectURL(file));
    return { path, name: file.name, type: file.type, size: file.size };
  }
  async attachmentUrl(path: string) {
    return this.s.files.get(path) ?? null;
  }
  async fetchLinkPreview(url: string) {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return {
      url,
      title: `A page on ${host}`,
      description: 'A short description of what this link is about, as the site describes it.',
      site: host,
      image: null,
    };
  }

  subscribe(communityId: string, cb: (e: CommunityEvent) => void) {
    const sub = { userId: this.me, communityId, cb };
    this.s.subs.add(sub);
    return () => void this.s.subs.delete(sub);
  }
}
