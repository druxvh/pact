/**
 * The real data layer: Supabase tables (protected by Row Level Security), Storage for attachments, an Edge Function
 * for link previews and Realtime for live updates. Thin on purpose — every rule lives in the database; this file only
 * shapes requests and responses. See supabase/migrations/*_communities.sql.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { avatarUrl } from '@/lib/supabase/avatar';
import { supabase } from '@/lib/supabase/client';
import type { CommunityApi, TypingChannel } from './api';
import {
  isMissingColumn,
  toActivityEvent,
  toBan,
  toChannel,
  toCommunityError,
  toInvite,
  toMember,
  toMessage,
  toProfile,
  toReaction,
  toUnread,
} from './mapping';
import { attachmentPaths, listAllFiles, removeInBatches } from './storageCleanup';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  type Attachment,
  type Community,
  CommunityError,
  type CommunityEvent,
  type GifPage,
  type LinkPreview,
  type Member,
  type Profile,
  type Role,
} from './types';

const MESSAGE_COLS =
  'id, community_id, channel_id, author_id, body, attachments, reply_to, created_at, edited_at, deleted_at, hidden_at, hidden_by, hidden_reason, links_removed_at';
const SIGNED_URL_SECONDS = 3600;
const MEDIA_BUCKET = 'community-media';

function client(): SupabaseClient {
  if (!supabase) throw new CommunityError('network', 'Accounts aren’t set up in this build.');
  return supabase;
}

/** Run a Supabase call and return its data, or throw a CommunityError. A null result (no such row) is `not_found`. */
async function ok<T>(call: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
  const { data, error } = await call;
  if (error) throw toCommunityError(error);
  if (data === null || data === undefined) throw new CommunityError('not_found');
  return data as NonNullable<T>;
}

/** Like `ok`, but "no row" is a normal answer (`maybeSingle`, or writes where we don't read back). */
async function okMaybe<T>(call: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await call;
  if (error) throw toCommunityError(error);
  return data;
}

/**
 * Run `primary` (which selects a column added by a recent migration); if the database doesn't have that column yet, run
 * `fallback` without it, so a build that is ahead of the database degrades (no avatars, no timeouts shown) instead of breaking.
 */
async function withColumnFallback<T>(primary: () => PromiseLike<{ data: T; error: unknown }>, fallback: () => PromiseLike<{ data: T; error: unknown }>) {
  const first = await primary();
  if (first.error && isMissingColumn(first.error)) return fallback();
  return first;
}

async function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const bmp = await createImageBitmap(file);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    return null;
  }
}

export function createSupabaseApi(me: string): CommunityApi {
  const signed = new Map<string, { url: string; expires: number }>();
  const now = () => new Date().toISOString();
  // Postgres hides rows you may not update (0 rows, no error), which surfaces here as "no such row" — to the person it's "not allowed".
  const updateMessage = async (id: string, patch: Record<string, unknown>) => {
    try {
      return toMessage(await ok(client().from('messages').update(patch).eq('id', id).select(MESSAGE_COLS).single()));
    } catch (err) {
      if (err instanceof CommunityError && err.code === 'not_found') throw new CommunityError('not_allowed');
      throw err;
    }
  };

  /** Only the admin may delete things that take files with them — checked here before any file is touched (RLS checks again). */
  const requireAdmin = async (communityId: string) => {
    const row = await okMaybe(client().from('community_members').select('role').eq('community_id', communityId).eq('user_id', me).maybeSingle());
    if (row?.role !== 'admin') throw new CommunityError('not_allowed');
  };

  /** Remove files from the bucket. Best effort: a file that can't be removed must not block deleting the rows. */
  const removeFiles = (paths: string[]) => removeInBatches((batch) => client().storage.from(MEDIA_BUCKET).remove(batch), paths);

  /** Every file path mentioned by a channel's messages and by their moderation originals. */
  const channelFilePaths = async (channelId: string): Promise<string[]> => {
    const paths = new Set<string>();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const rows = await ok(
        client()
          .from('messages')
          .select('attachments')
          .eq('channel_id', channelId)
          .neq('attachments', '[]')
          .range(from, from + PAGE - 1),
      );
      for (const p of attachmentPaths(rows)) paths.add(p);
      if (rows.length < PAGE) break;
    }
    for (let from = 0; ; from += PAGE) {
      const rows = await ok(
        client()
          .from('message_originals')
          .select('attachments, messages!inner(channel_id)')
          .eq('messages.channel_id', channelId)
          .range(from, from + PAGE - 1),
      );
      for (const p of attachmentPaths(rows)) paths.add(p);
      if (rows.length < PAGE) break;
    }
    return [...paths];
  };

  return {
    me,

    async listCommunities() {
      const rows = await ok(client().from('community_members').select('role, communities(id, name, description, hue, created_at)').eq('user_id', me));
      return (rows as unknown as Array<{ role: Role; communities: { id: string; name: string; description: string; hue: number; created_at: string } | null }>)
        .filter((r) => r.communities)
        .map((r): Community => {
          const c = r.communities as NonNullable<typeof r.communities>;
          return { id: c.id, name: c.name, description: c.description, hue: c.hue, role: r.role, createdAt: c.created_at };
        })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async createCommunity(input) {
      const id = crypto.randomUUID(); // chosen here so we don't need to read the row back before we're a member
      await okMaybe(client().from('communities').insert({ id, name: input.name.trim(), description: input.description.trim(), hue: input.hue }));
      return id;
    },
    async updateCommunity(id, patch) {
      await okMaybe(
        client()
          .from('communities')
          .update({
            ...(patch.name !== undefined && { name: patch.name.trim() }),
            ...(patch.description !== undefined && { description: patch.description.trim() }),
          })
          .eq('id', id),
      );
    },
    async deleteCommunity(id) {
      await requireAdmin(id);
      // Files first: once the community row is gone nobody is a member any more, so Storage's rules would refuse the cleanup.
      const bucket = client().storage.from(MEDIA_BUCKET);
      const files = await listAllFiles(async (folder, offset, limit) => {
        const { data, error } = await bucket.list(folder, { limit, offset });
        if (error) throw toCommunityError(error);
        return (data ?? []).map((f) => ({ name: f.name, id: f.id }));
      }, id);
      await removeFiles(files);
      await okMaybe(client().from('communities').delete().eq('id', id));
    },
    async leaveCommunity(id) {
      // A timed-out member can't leave (the database raises `timed_out`); the admin matches no row.
      const rows = await ok(client().from('community_members').delete().eq('community_id', id).eq('user_id', me).select('user_id'));
      if (!rows.length) throw new CommunityError('not_allowed');
    },

    async previewInvite(code) {
      const rows = (await okMaybe(client().rpc('preview_invite', { p_code: code }))) as Array<{
        community_id: string;
        name: string;
        description: string;
        hue: number;
        members: number;
      }> | null;
      const r = rows?.[0];
      return r ? { communityId: r.community_id, name: r.name, description: r.description, hue: r.hue, members: Number(r.members) } : null;
    },
    async joinCommunity(code) {
      return ((await okMaybe(client().rpc('join_community', { p_code: code }))) as string | null) ?? null;
    },
    async listInvites(communityId) {
      const rows = await ok(client().from('invites').select('*').eq('community_id', communityId).order('created_at', { ascending: false }));
      return rows.map(toInvite);
    },
    async createInvite(communityId, opts) {
      const expires = opts.expiresInHours ? new Date(Date.now() + opts.expiresInHours * 3_600_000).toISOString() : null;
      return toInvite(
        await ok(client().from('invites').insert({ community_id: communityId, max_uses: opts.maxUses, expires_at: expires }).select('*').single()),
      );
    },
    async revokeInvite(code) {
      await okMaybe(client().from('invites').delete().eq('code', code));
    },

    async listChannels(communityId) {
      return (await ok(client().from('channels').select('*').eq('community_id', communityId).order('created_at'))).map(toChannel);
    },
    async createChannel(communityId, name, topic) {
      return toChannel(await ok(client().from('channels').insert({ community_id: communityId, name, topic }).select('*').single()));
    },
    async deleteChannel(channelId) {
      const ch = await okMaybe(client().from('channels').select('community_id').eq('id', channelId).maybeSingle());
      if (!ch) return;
      await requireAdmin(ch.community_id as string);
      await removeFiles(await channelFilePaths(channelId));
      await okMaybe(client().from('channels').delete().eq('id', channelId));
    },
    async setSlowmode(channelId, seconds) {
      // RLS lets moderators and the admin through (a trigger keeps moderators to this one column); anyone else matches no row.
      const rows = await ok(client().from('channels').update({ slowmode_seconds: seconds }).eq('id', channelId).select('*'));
      const row = rows[0];
      if (!row) throw new CommunityError('not_allowed');
      return toChannel(row);
    },

    async listMembers(communityId): Promise<Member[]> {
      const q = (cols: string) => client().from('community_members').select(cols).eq('community_id', communityId).order('joined_at');
      const { data, error } = await withColumnFallback(
        () => q('user_id, role, joined_at, timeout_until'),
        () => q('user_id, role, joined_at'),
      );
      if (error) throw toCommunityError(error);
      return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(toMember);
    },
    async getProfiles(ids): Promise<Profile[]> {
      if (!ids.length) return [];
      const q = (cols: string) => client().from('profiles').select(cols).in('id', ids);
      const { data, error } = await withColumnFallback(
        () => q('id, username, display_name, designation, avatar_path'),
        () => q('id, username, display_name, designation'),
      );
      if (error) throw toCommunityError(error);
      return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((r) => toProfile(r, avatarUrl));
    },
    async setRole(communityId, userId, role) {
      const rows = await ok(client().from('community_members').update({ role }).eq('community_id', communityId).eq('user_id', userId).select('user_id'));
      if (!rows.length) throw new CommunityError('not_allowed');
    },
    async kickMember(communityId, userId) {
      const rows = await ok(client().from('community_members').delete().eq('community_id', communityId).eq('user_id', userId).select('user_id'));
      if (!rows?.length) throw new CommunityError('not_allowed');
    },
    async banMember(communityId, userId, reason) {
      // One statement: a database trigger removes the membership as part of the ban, so it can't half-happen.
      await okMaybe(
        client()
          .from('community_bans')
          .insert({ community_id: communityId, user_id: userId, banned_by: me, reason: reason.slice(0, 200) }),
      );
    },
    async listBans(communityId) {
      const rows = await ok(
        client()
          .from('community_bans')
          .select('user_id, banned_by, reason, created_at')
          .eq('community_id', communityId)
          .order('created_at', { ascending: false }),
      );
      return rows.map(toBan);
    },
    async unbanMember(communityId, userId) {
      // The policy lets the admin (any ban) or the moderator who issued it through; otherwise no row matches.
      const rows = await ok(client().from('community_bans').delete().eq('community_id', communityId).eq('user_id', userId).select('user_id'));
      if (!rows.length) throw new CommunityError('not_allowed');
    },
    async timeoutMember(communityId, userId, seconds) {
      const until = await okMaybe(client().rpc('timeout_member', { p_community: communityId, p_user: userId, p_seconds: Math.max(0, Math.floor(seconds)) }));
      return typeof until === 'string' ? until : null;
    },
    async transferAdmin(communityId, userId) {
      try {
        await okMaybe(client().rpc('transfer_admin', { p_community: communityId, p_new_admin: userId }));
      } catch (err) {
        if (err instanceof CommunityError && err.code === 'banned') throw new CommunityError('banned', 'That person is banned from this community.');
        throw err;
      }
    },
    async getMessageAuthor(messageId) {
      const r = await okMaybe(client().from('messages').select('author_id').eq('id', messageId).maybeSingle());
      return typeof r?.author_id === 'string' ? r.author_id : null;
    },

    async listMessages(channelId, opts) {
      let q = client()
        .from('messages')
        .select(MESSAGE_COLS)
        .eq('channel_id', channelId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(opts.limit);
      if (opts.before) q = q.or(`created_at.lt.${opts.before.createdAt},and(created_at.eq.${opts.before.createdAt},id.lt.${opts.before.id})`);
      return (await ok(q)).map(toMessage);
    },
    async sendMessage(input) {
      const row = await ok(
        client()
          .from('messages')
          .insert({
            community_id: input.communityId,
            channel_id: input.channelId,
            body: input.body.trim(),
            attachments: input.attachments,
            reply_to: input.replyTo,
          })
          .select(MESSAGE_COLS)
          .single(),
      );
      return toMessage(row);
    },
    editMessage: (id, body) => updateMessage(id, { body: body.trim() }),
    deleteMessage: (id) => updateMessage(id, { deleted_at: now() }),
    hideMessage: (id, reason) => updateMessage(id, { hidden_at: now(), hidden_reason: reason.slice(0, 200) }),
    restoreMessage: (id) => updateMessage(id, { hidden_at: null }),
    stripLinks: (id) => updateMessage(id, { links_removed_at: now() }),
    async getOriginal(id) {
      const r = await okMaybe(client().from('message_originals').select('body, attachments').eq('message_id', id).maybeSingle());
      return r ? { body: String(r.body ?? ''), attachments: toMessage({ attachments: r.attachments }).attachments } : null;
    },

    async listReactions(messageIds) {
      if (!messageIds.length) return [];
      return (await ok(client().from('message_reactions').select('message_id, user_id, emoji').in('message_id', messageIds))).map(toReaction);
    },
    async addReaction(message, emoji) {
      const { error } = await client().from('message_reactions').insert({ message_id: message.id, community_id: message.communityId, emoji });
      if (error && (error as { code?: string }).code !== '23505') throw toCommunityError(error); // already reacted: fine
    },
    async removeReaction(messageId, emoji) {
      await okMaybe(client().from('message_reactions').delete().eq('message_id', messageId).eq('user_id', me).eq('emoji', emoji));
    },

    async uploadAttachment(communityId, file): Promise<Attachment> {
      if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) throw new CommunityError('bad_type');
      if (file.size > ATTACHMENT_MAX_BYTES) throw new CommunityError('too_large');
      const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-60) || 'file';
      const path = `${communityId}/${me}/${crypto.randomUUID()}-${safe}`;
      const { error } = await client().storage.from(MEDIA_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        // Storage reports a refused insert as a row-level-security error; for an upload by a member it means the per-person quota.
        const err = toCommunityError(error);
        throw err.code === 'not_allowed' ? new CommunityError('upload_limit') : err;
      }
      const dims = await imageSize(file);
      return { path, name: file.name.slice(0, 120), type: file.type, size: file.size, ...dims };
    },
    async attachmentUrl(path) {
      const hit = signed.get(path);
      if (hit && hit.expires > Date.now()) return hit.url;
      const { data, error } = await client().storage.from(MEDIA_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
      if (error || !data?.signedUrl) return null;
      signed.set(path, { url: data.signedUrl, expires: Date.now() + (SIGNED_URL_SECONDS - 600) * 1000 });
      return data.signedUrl;
    },
    async fetchLinkPreview(url): Promise<LinkPreview | null> {
      const { data, error } = await client().functions.invoke('link-preview', { body: { url } });
      if (error || !data?.ok) return null;
      return { url: String(data.url), title: data.title ?? null, description: data.description ?? null, site: data.site ?? null, image: data.image ?? null };
    },

    async unreadCounts() {
      return ((await ok(client().rpc('unread_counts'))) as Array<Record<string, unknown>>).map(toUnread);
    },
    async markRead(channel, upTo) {
      await okMaybe(
        client()
          .from('channel_reads')
          .upsert({ user_id: me, channel_id: channel.id, community_id: channel.communityId, last_read_at: upTo }, { onConflict: 'user_id,channel_id' }),
      );
    },
    subscribeActivity(onMessage) {
      const c = client();
      // No filter: Realtime applies Row Level Security per subscriber, so this only ever delivers messages from communities you are in.
      const channel = c
        .channel('community-activity')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
          const e = toActivityEvent(p.new as Record<string, unknown>);
          if (e) onMessage(e);
        })
        .subscribe();
      return () => void c.removeChannel(channel);
    },
    subscribeTyping(communityId, onTyping): TypingChannel {
      const c = client();
      // A private broadcast topic: the policies on realtime.messages only admit members of this community.
      const channel = c
        .channel(`typing:${communityId}`, { config: { private: true, broadcast: { self: false } } })
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          const { channelId, userId } = (payload ?? {}) as { channelId?: unknown; userId?: unknown };
          if (typeof channelId === 'string' && typeof userId === 'string') onTyping({ channelId, userId });
        })
        .subscribe();
      return {
        announce: (channelId) => void channel.send({ type: 'broadcast', event: 'typing', payload: { channelId, userId: me } }),
        stop: () => void c.removeChannel(channel),
      };
    },
    async searchGifs(query, opts): Promise<GifPage> {
      const { data, error } = await client().functions.invoke('gif-search', { body: { q: query, next: opts?.next ?? null } });
      if (error) throw toCommunityError(error);
      if (!data?.ok) throw new CommunityError(data?.error === 'not_configured' ? 'not_configured' : 'unknown', 'GIF search isn’t available right now.');
      return { gifs: data.gifs ?? [], next: typeof data.next === 'string' ? data.next : null };
    },

    subscribe(communityId, onEvent: (e: CommunityEvent) => void) {
      const c = client();
      const filter = `community_id=eq.${communityId}`;
      const channel = c
        .channel(`community:${communityId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'messages', filter },
          (p) => p.new && 'id' in p.new && onEvent({ type: 'message', message: toMessage(p.new) }),
        )
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions', filter }, (p) =>
          onEvent({ type: 'reaction-added', reaction: toReaction(p.new) }),
        )
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions', filter }, (p) =>
          onEvent({ type: 'reaction-removed', reaction: toReaction(p.old) }),
        )
        .on('postgres_changes', { event: '*', schema: 'public', table: 'community_members', filter }, () => onEvent({ type: 'members-changed' }))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'channels', filter }, () => onEvent({ type: 'channels-changed' }))
        .subscribe();
      return () => void c.removeChannel(channel);
    },
  };
}

// One API object per signed-in user.
let cached: { id: string; api: CommunityApi } | null = null;
export function communityApiFor(userId: string): CommunityApi {
  if (!cached || cached.id !== userId) cached = { id: userId, api: createSupabaseApi(userId) };
  return cached.api;
}
