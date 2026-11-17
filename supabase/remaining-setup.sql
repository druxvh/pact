-- pact: finish the database setup (paste into Supabase → SQL Editor → Run, once).
--
-- The Supabase MCP tool applied part of the schema for you (tables with row level security switched on and NO policies,
-- i.e. locked down; helper functions; limits; the ban trigger; profile_private + the username change) and refused the
-- rest. This file is exactly the rest, in dependency order. It is safe to run once on the current database state.
-- It is generated from supabase/migrations/*.sql, which remain the source of truth, and was verified by replaying the
-- same split in the local PGlite test database and running all 59 RLS checks against the result.
--
-- What it does, in order:
--   1. the moderation guard on messages (server-stamped times, originals can't be forged)
--   2. the invite functions (preview / join, with the guessing throttle)
--   3. row level security policies, per-column grants, Storage rules, Realtime publication
--   4. drops the old profiles email column and the superseded profiles policy (the destructive bits)
--   5. unread counts + typing-indicator rules

-- SECURITY DEFINER because it archives/purges `message_originals`, which no caller can write directly. It checks
-- auth.uid() against the roles itself and stamps every moderation time from the server clock.
create function private.messages_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  mod boolean;
  author boolean;
  link_re constant text := '(https?://|www\.)\S+';
begin
  if tg_op = 'INSERT' then
    new.created_at := clock_timestamp(); -- a client can't pin a message to the top (or backdate it past everyone's unread count)
    new.edited_at := null; new.deleted_at := null; new.hidden_at := null; new.hidden_by := null;
    new.hidden_reason := ''; new.links_removed_at := null;
    perform private.check_attachments(new.attachments, new.community_id);
    return new;
  end if;

  if new.id <> old.id or new.community_id <> old.community_id or new.channel_id <> old.channel_id
     or new.author_id <> old.author_id or new.created_at <> old.created_at or new.reply_to is distinct from old.reply_to then
    raise exception 'immutable_column' using errcode = 'P0001';
  end if;

  mod := private.is_mod(old.community_id);
  author := old.author_id = uid;

  -- hide
  if old.hidden_at is null and new.hidden_at is not null then
    if not mod then raise exception 'not_allowed' using errcode = 'P0001'; end if;
    insert into public.message_originals (message_id, community_id, body, attachments, saved_by)
      values (old.id, old.community_id, old.body, old.attachments, uid) on conflict (message_id) do nothing;
    new.hidden_at := now(); new.hidden_by := uid; new.body := ''; new.attachments := '[]'::jsonb;
    new.edited_at := old.edited_at; new.deleted_at := old.deleted_at; new.links_removed_at := old.links_removed_at;
    return new;
  end if;

  -- restore
  if old.hidden_at is not null and new.hidden_at is null then
    if not mod then raise exception 'not_allowed' using errcode = 'P0001'; end if;
    select o.body, o.attachments into new.body, new.attachments from public.message_originals o where o.message_id = old.id;
    if not found then new.body := old.body; new.attachments := old.attachments; end if;
    delete from public.message_originals where message_id = old.id;
    if old.deleted_at is not null then
      -- the author deleted it while it was hidden: it stays gone, nothing is resurrected
      new.body := ''; new.attachments := '[]'::jsonb;
    elsif old.links_removed_at is not null then
      -- links a moderator removed stay removed
      new.body := regexp_replace(new.body, link_re, '[link removed]', 'gi');
    end if;
    new.hidden_by := null; new.hidden_reason := '';
    new.edited_at := old.edited_at; new.deleted_at := old.deleted_at; new.links_removed_at := old.links_removed_at;
    return new;
  end if;

  -- strip links
  if old.links_removed_at is null and new.links_removed_at is not null then
    if not mod then raise exception 'not_allowed' using errcode = 'P0001'; end if;
    insert into public.message_originals (message_id, community_id, body, attachments, saved_by)
      values (old.id, old.community_id, old.body, old.attachments, uid) on conflict (message_id) do nothing;
    new.links_removed_at := now();
    new.body := regexp_replace(old.body, link_re, '[link removed]', 'gi');
    new.attachments := old.attachments; new.hidden_at := old.hidden_at; new.hidden_by := old.hidden_by;
    new.hidden_reason := old.hidden_reason; new.edited_at := old.edited_at; new.deleted_at := old.deleted_at;
    return new;
  end if;

  -- the author deletes their own message: gone for everyone, including any archived original
  if old.deleted_at is null and new.deleted_at is not null then
    if not author then raise exception 'not_allowed' using errcode = 'P0001'; end if;
    delete from public.message_originals where message_id = old.id;
    new.deleted_at := now(); new.body := ''; new.attachments := '[]'::jsonb;
    new.hidden_at := old.hidden_at; new.hidden_by := old.hidden_by; new.hidden_reason := old.hidden_reason;
    new.links_removed_at := old.links_removed_at; new.edited_at := old.edited_at;
    return new;
  end if;

  -- the author edits their own message (only while it is intact)
  if new.body is distinct from old.body or new.attachments is distinct from old.attachments then
    if not author or old.hidden_at is not null or old.deleted_at is not null or old.links_removed_at is not null then
      raise exception 'not_allowed' using errcode = 'P0001';
    end if;
    perform private.check_attachments(new.attachments, old.community_id);
    new.edited_at := now();
  end if;

  -- anything else must leave the moderation columns alone
  new.deleted_at := old.deleted_at; new.hidden_at := old.hidden_at; new.hidden_by := old.hidden_by;
  new.hidden_reason := old.hidden_reason; new.links_removed_at := old.links_removed_at;
  return new;
end;
$$;
revoke all on function private.check_attachments(jsonb, uuid), private.messages_guard() from public, anon, authenticated;
create trigger messages_guard_trg before insert or update on public.messages for each row execute function private.messages_guard();


-- ── invites: the two operations a non-member has to be able to do ──

create function private.throttle_invites() returns void
language plpgsql security definer set search_path = ''
as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  delete from public.invite_attempts where user_id = uid and at < now() - interval '1 hour';
  if (select count(*) from public.invite_attempts where user_id = uid and at > now() - interval '10 minutes') >= 15 then
    raise exception 'rate_limited' using errcode = 'P0001', hint = 'Too many wrong codes — wait a few minutes.';
  end if;
end;
$$;

create function private.note_failed_invite() returns void
language sql security definer set search_path = ''
as $$ insert into public.invite_attempts (user_id) values ((select auth.uid())) $$;

revoke all on function private.throttle_invites(), private.note_failed_invite() from public, anon, authenticated;

-- Peek at an invite before accepting it. Returns nothing for an unusable code.
create function public.preview_invite(p_code text)
returns table (community_id uuid, name text, description text, hue smallint, members bigint)
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.throttle_invites();
  return query
    select c.id, c.name, c.description, c.hue, (select count(*) from public.community_members m where m.community_id = c.id)
    from public.invites i join public.communities c on c.id = i.community_id
    where i.code = lower(btrim(p_code)) and (i.expires_at is null or i.expires_at > now()) and (i.max_uses is null or i.uses < i.max_uses)
      and not exists (select 1 from public.community_bans b where b.community_id = c.id and b.user_id = (select auth.uid()));
  if not found then perform private.note_failed_invite(); end if;
end;
$$;

-- Redeem an invite. Returns the community id, or NULL for a code that is unknown, expired or used up (counted by the
-- throttle). Idempotent for someone who is already a member.
create function public.join_community(p_code text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  inv public.invites%rowtype;
begin
  perform private.throttle_invites();
  select * into inv from public.invites i where i.code = lower(btrim(p_code)) for update;
  if not found or (inv.expires_at is not null and inv.expires_at <= now()) or (inv.max_uses is not null and inv.uses >= inv.max_uses) then
    -- a member re-opening an old link shouldn't be told it failed
    if found and exists (select 1 from public.community_members m where m.community_id = inv.community_id and m.user_id = uid) then
      return inv.community_id;
    end if;
    -- Record the miss and return NULL (not an error): raising would roll the miss back and defeat the throttle.
    perform private.note_failed_invite();
    return null;
  end if;
  if exists (select 1 from public.community_bans b where b.community_id = inv.community_id and b.user_id = uid) then
    raise exception 'banned' using errcode = 'P0001', hint = 'You can’t join this community.';
  end if;
  if exists (select 1 from public.community_members m where m.community_id = inv.community_id and m.user_id = uid) then
    return inv.community_id;
  end if;
  if (select count(*) from public.community_members m where m.user_id = uid) >= 50 then
    raise exception 'too_many_communities' using errcode = 'P0001', hint = 'You can be in up to 50 communities.';
  end if;
  insert into public.community_members (community_id, user_id, role) values (inv.community_id, uid, 'member');
  update public.invites set uses = uses + 1 where code = inv.code;
  return inv.community_id;
end;
$$;

revoke all on function public.preview_invite(text), public.join_community(text) from public, anon;
grant execute on function public.preview_invite(text), public.join_community(text) to authenticated;


-- ── row level security ───────────────────────────────────────────────────────

alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_bans enable row level security;
alter table public.channels enable row level security;
alter table public.invites enable row level security;
alter table public.messages enable row level security;
alter table public.message_originals enable row level security;
alter table public.message_reactions enable row level security;
alter table public.invite_attempts enable row level security;
alter table public.link_previews enable row level security;
-- invite_attempts and link_previews get no policies: only the SECURITY DEFINER functions / service role touch them.

create policy "communities: members read" on public.communities for select to authenticated using (private.is_member(id));
create policy "communities: anyone creates their own" on public.communities for insert to authenticated with check ((select auth.uid()) = created_by);
create policy "communities: admin edits" on public.communities for update to authenticated using (private.is_admin(id)) with check (private.is_admin(id));
create policy "communities: admin deletes" on public.communities for delete to authenticated using (private.is_admin(id));

create policy "members: members read the roster" on public.community_members for select to authenticated using (private.is_member(community_id));
-- No INSERT policy: people join through join_community() / creating a community.
create policy "members: admin sets roles" on public.community_members for update to authenticated
  using (private.is_admin(community_id) and role <> 'admin') with check (private.is_admin(community_id) and role in ('mod', 'member'));
create policy "members: leave or be removed" on public.community_members for delete to authenticated using (
  (user_id = (select auth.uid()) and role <> 'admin')
  or (private.is_mod(community_id) and role = 'member')
  or (private.is_admin(community_id) and role <> 'admin')
);

create policy "bans: mods read" on public.community_bans for select to authenticated using (private.is_mod(community_id));
create policy "bans: mods ban members" on public.community_bans for insert to authenticated
  with check (
    private.is_mod(community_id) and banned_by = (select auth.uid()) and user_id <> (select auth.uid())
    -- only the admin can ban a moderator; nobody can ban the admin
    and not exists (select 1 from public.community_members m where m.community_id = community_bans.community_id and m.user_id = community_bans.user_id and m.role = 'admin')
    and (private.is_admin(community_id) or not exists (select 1 from public.community_members m where m.community_id = community_bans.community_id and m.user_id = community_bans.user_id and m.role = 'mod'))
  );
-- A ban is lifted by the admin, or by the moderator who issued it — never by the person it applies to, and a moderator
-- can't undo the admin's decisions.
create policy "bans: lift your own or any as admin" on public.community_bans for delete to authenticated
  using (private.is_mod(community_id) and user_id <> (select auth.uid()) and (private.is_admin(community_id) or banned_by = (select auth.uid())));

create policy "channels: members read" on public.channels for select to authenticated using (private.is_member(community_id));
create policy "channels: admin creates" on public.channels for insert to authenticated with check (private.is_admin(community_id));
create policy "channels: admin edits" on public.channels for update to authenticated using (private.is_admin(community_id)) with check (private.is_admin(community_id));
create policy "channels: admin deletes" on public.channels for delete to authenticated using (private.is_admin(community_id));

create policy "invites: mods read" on public.invites for select to authenticated using (private.is_mod(community_id));
create policy "invites: mods create" on public.invites for insert to authenticated with check (private.is_mod(community_id) and created_by = (select auth.uid()) and uses = 0);
create policy "invites: mods revoke" on public.invites for delete to authenticated using (private.is_mod(community_id));

create policy "messages: members read" on public.messages for select to authenticated using (private.is_member(community_id));
create policy "messages: members post" on public.messages for insert to authenticated with check (private.is_member(community_id) and author_id = (select auth.uid()));
create policy "messages: author or mod edits" on public.messages for update to authenticated
  using (private.is_member(community_id) and (author_id = (select auth.uid()) or private.is_mod(community_id)))
  with check (private.is_member(community_id) and (author_id = (select auth.uid()) or private.is_mod(community_id)));
-- No DELETE policy: messages are tombstoned, never erased.

-- Read-only for mods. Writes happen only inside private.messages_guard() (SECURITY DEFINER): there is deliberately no
-- INSERT or DELETE policy, so an original can't be forged, planted on another community's message, or destroyed.
create policy "originals: mods read" on public.message_originals for select to authenticated using (private.is_mod(community_id));

create policy "reactions: members read" on public.message_reactions for select to authenticated using (private.is_member(community_id));
create policy "reactions: members react" on public.message_reactions for insert to authenticated with check (private.is_member(community_id) and user_id = (select auth.uid()));
create policy "reactions: remove your own" on public.message_reactions for delete to authenticated using (user_id = (select auth.uid()));

-- Profiles: people in a community with you can see your public profile (never your email — that is in profile_private).
drop policy "profiles: read own" on public.profiles;
create policy "profiles: read own or shared community" on public.profiles for select to authenticated
  using ((select auth.uid()) = id or private.shares_community(id));

-- ── table privileges ─────────────────────────────────────────────────────────

revoke all on table public.communities, public.community_members, public.community_bans, public.channels, public.invites,
  public.messages, public.message_originals, public.message_reactions, public.invite_attempts, public.link_previews from anon, authenticated;
-- UPDATE is granted per column: RLS decides which rows you may change, these decide which fields — so nobody can re-point a
-- membership at another user (a forced join) or reassign a community's creator (to dodge the per-creator limit).
grant select, insert, delete on table public.communities, public.channels to authenticated;
grant update (name, description, hue) on table public.communities to authenticated;
grant update (name, topic) on table public.channels to authenticated;
grant select, delete on table public.community_members to authenticated;
grant update (role) on table public.community_members to authenticated;
grant select, insert, delete on table public.community_bans to authenticated;
-- Invite codes are always generated: a client can't pick one (that would let it probe which codes exist via duplicate-key
-- errors) or set the use count.
grant select, delete on table public.invites to authenticated;
grant insert (community_id, max_uses, expires_at) on table public.invites to authenticated;
grant select, insert on table public.messages to authenticated;
-- the moderation columns are included on purpose: the guard trigger decides who may set them, and stamps the times itself
grant update (body, attachments, deleted_at, hidden_at, hidden_reason, links_removed_at) on table public.messages to authenticated;
grant select on table public.message_originals to authenticated;
grant select, insert, delete on table public.message_reactions to authenticated;

-- ── Storage: private bucket for attachments, public bucket for server-made link-preview thumbnails ──

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('community-media', 'community-media', false, 26214400,
   array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm']),
  ('link-previews', 'link-previews', true, 2097152, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

-- Paths are  <community id>/<uploader id>/<file>.
--   read    a member, and only: their own uploads (so they can preview before sending), anything if they moderate, or a
--           file that a *visible* message references. So a hidden / deleted / edited-away attachment is really gone for
--           ordinary members, not merely un-linked.
--   write   into your own folder only, at most 300 files per person per community.
--   remove  the uploader, or a moderator.
-- The community folder must be a canonical lowercase UUID (a looser pattern would accept look-alikes that cleanup misses).

create function private.media_community(obj_name text) returns uuid
language sql stable set search_path = ''
as $$
  select case
    when (storage.foldername(obj_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then ((storage.foldername(obj_name))[1])::uuid
  end
$$;

create function private.can_read_media(obj_name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    private.is_member(x.cid) and (
      (storage.foldername(obj_name))[2] = (select auth.uid())::text
      or private.is_mod(x.cid)
      or exists (
        select 1 from public.messages m
        where m.community_id = x.cid and m.hidden_at is null and m.deleted_at is null
          and m.attachments @> jsonb_build_array(jsonb_build_object('path', obj_name))
      )
    ),
    false
  )
  from (select private.media_community(obj_name) as cid) x
$$;

create function private.media_files(cid uuid, uid uuid) returns integer
language sql stable security definer set search_path = ''
as $$ select count(*)::int from storage.objects o where o.bucket_id = 'community-media' and o.name like cid::text || '/' || uid::text || '/%' $$;

revoke all on function private.media_community(text), private.can_read_media(text), private.media_files(uuid, uuid) from public, anon;
grant execute on function private.media_community(text), private.can_read_media(text), private.media_files(uuid, uuid) to authenticated;

create policy "community media: members read" on storage.objects for select to authenticated using (
  bucket_id = 'community-media' and private.can_read_media(name)
);
create policy "community media: members upload to their own folder" on storage.objects for insert to authenticated with check (
  bucket_id = 'community-media'
  and array_length(storage.foldername(name), 1) = 2
  and private.is_member(private.media_community(name))
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and private.media_files(private.media_community(name), (select auth.uid())) < 300
);
create policy "community media: uploader or mod removes" on storage.objects for delete to authenticated using (
  bucket_id = 'community-media' and private.media_community(name) is not null
  and ((storage.foldername(name))[2] = (select auth.uid())::text or private.is_mod(private.media_community(name)))
);
-- link-previews: world-readable (it's a public bucket); no write policy, so only the Edge Function (service role) writes.

-- ── Realtime ─────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.messages, public.message_reactions, public.community_members, public.channels;

-- ── profiles: the email now lives in profile_private ──
alter table public.profiles drop constraint profiles_text_lengths;
alter table public.profiles drop column contact_email;
alter table public.profiles add constraint profiles_text_lengths check (
  char_length(display_name) <= 40 and char_length(designation) <= 60 and char_length(bio) <= 160
);


-- ── unread counts and typing indicators ──
-- pact: communities — unread counts and typing indicators.
--
--   * `channel_reads` remembers, per person and channel, the time of the newest message they have seen. Unread = messages
--     by other people newer than that (or newer than when you joined, if you never opened the channel — so joining an old
--     community doesn't greet you with "9,000 unread"). Only you can read or write your own rows.
--   * `unread_counts()` returns the channels that have unread messages, capped at 100 per channel so it stays cheap.
--     It is SECURITY INVOKER: RLS still decides which messages you may count.
--   * Typing indicators are ephemeral Realtime *broadcast* messages on a private topic `typing:<community id>` — nothing
--     is stored. The policies on `realtime.messages` let only members of that community listen or announce.

-- ── read state ───────────────────────────────────────────────────────────────

create table public.channel_reads (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  channel_id uuid not null,
  community_id uuid not null,
  last_read_at timestamptz not null,
  primary key (user_id, channel_id),
  foreign key (channel_id, community_id) references public.channels (id, community_id) on delete cascade
);
create index channel_reads_channel_idx on public.channel_reads (channel_id, community_id);
create index channel_reads_community_idx on public.channel_reads (community_id);

-- A device that is behind (an old tab, a late request) must never move the marker backwards.
create function private.keep_latest_read() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.last_read_at := greatest(old.last_read_at, new.last_read_at);
  return new;
end;
$$;
create trigger channel_reads_keep_latest before update on public.channel_reads for each row execute function private.keep_latest_read();

alter table public.channel_reads enable row level security;
create policy "reads: read own" on public.channel_reads for select to authenticated using ((select auth.uid()) = user_id);
create policy "reads: mark own" on public.channel_reads for insert to authenticated
  with check ((select auth.uid()) = user_id and private.is_member(community_id));
create policy "reads: update own" on public.channel_reads for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and private.is_member(community_id));
create policy "reads: delete own" on public.channel_reads for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.channel_reads from anon, authenticated;
grant select, insert, update, delete on table public.channel_reads to authenticated;

-- ── unread counts ────────────────────────────────────────────────────────────

create function public.unread_counts()
returns table (channel_id uuid, community_id uuid, unread integer)
language sql stable security invoker set search_path = ''
as $$
  select t.channel_id, t.community_id, t.unread
  from (
    select c.id as channel_id, c.community_id,
      (
        select count(*)::int from (
          select 1 from public.messages m
          where m.channel_id = c.id
            and m.author_id <> (select auth.uid())
            and m.created_at > coalesce(r.last_read_at, cm.joined_at)
            and m.deleted_at is null and m.hidden_at is null
          limit 100
        ) capped
      ) as unread
    from public.community_members cm
    join public.channels c on c.community_id = cm.community_id
    left join public.channel_reads r on r.channel_id = c.id and r.user_id = cm.user_id
    where cm.user_id = (select auth.uid())
  ) t
  where t.unread > 0
$$;

revoke all on function public.unread_counts() from public, anon;
grant execute on function public.unread_counts() to authenticated;

-- ── typing indicators: who may listen / announce on `typing:<community id>` ──

create function private.typing_community(topic text) returns uuid
language sql immutable set search_path = ''
as $$
  select case
    when topic ~ '^typing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then substr(topic, 8)::uuid
  end
$$;
grant execute on function private.typing_community(text) to authenticated;

create policy "typing: members listen" on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and private.is_member(private.typing_community((select realtime.topic()))));
create policy "typing: members announce" on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and private.is_member(private.typing_community((select realtime.topic()))));
