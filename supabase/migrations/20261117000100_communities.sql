-- pact: invite-only communities (Discord-style) with roles and moderation.
--
-- Model
--   * A community has members with a role: `admin` (exactly one — the owner), `mod` (sub-admin, appointed by the admin)
--     or `member`. Nobody can read or post in a community they aren't a member of; there is no public listing.
--   * You get in only with an invite code (`join_community`). Codes can expire, have a use limit, and be revoked.
--   * Messages live in channels. They can reply to another message in the same channel, carry attachments (files in a
--     private Storage bucket) and have emoji reactions.
--   * Moderation never leaves content readable to members: hiding a message (or stripping its links) *moves* the
--     original into `message_originals`, which only mods can read, and blanks it in `messages`. Restoring moves it
--     back. So "hidden" really means hidden, even from someone calling the API directly — including its attachments
--     (Storage only serves a file to members while a visible message references it). Nobody, mods included, can write
--     to `message_originals` directly: only the messages trigger (SECURITY DEFINER) does, so an "original" can't be forged.
--   * Moderation state is stamped by the server (created_at, hidden_at, deleted_at, links_removed_at), never trusted
--     from the client's clock.
--
-- Security notes
--   * RLS on every table; `anon` has no access. The helpers used by policies live in the unexposed `private` schema.
--   * Policies never trust client-supplied roles; they read `community_members`.
--   * SECURITY DEFINER is used only where a rule must touch something the caller can't: the invite RPCs (a non-member
--     must be able to redeem a code), the creation/ban/limit triggers, the messages guard (archiving originals) and the
--     membership / media-read helpers. Each checks auth.uid() and pins search_path.
--   * UPDATE grants are per column, so a policy that checks *which rows* can't be sidestepped by changing *which columns*
--     (e.g. re-pointing a membership at someone else, or reassigning a community's creator).

grant usage on schema private to authenticated;

-- ── helpers ──────────────────────────────────────────────────────────────────

create function private.gen_invite_code() returns text
language sql volatile set search_path = ''
as $$ select substr(md5(gen_random_uuid()::text || gen_random_uuid()::text), 1, 16) $$;

grant execute on function private.gen_invite_code() to authenticated; -- the invites.code default runs as the caller

-- ── tables ───────────────────────────────────────────────────────────────────

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  hue smallint not null default 0,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint communities_name_length check (char_length(btrim(name)) between 2 and 60),
  constraint communities_description_length check (char_length(description) <= 300),
  constraint communities_hue_range check (hue between 0 and 359)
);
create index communities_created_by_idx on public.communities (created_by);

create table public.community_members (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id),
  constraint community_members_role check (role in ('admin', 'mod', 'member'))
);
create index community_members_user_idx on public.community_members (user_id);
create unique index community_one_admin_idx on public.community_members (community_id) where role = 'admin';

create table public.community_bans (
  community_id uuid not null references public.communities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  banned_by uuid references auth.users (id) on delete set null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (community_id, user_id),
  constraint community_bans_reason_length check (char_length(reason) <= 200)
);
create index community_bans_banned_by_idx on public.community_bans (banned_by);
create index community_bans_user_idx on public.community_bans (user_id);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities (id) on delete cascade,
  name text not null,
  topic text not null default '',
  created_at timestamptz not null default now(),
  constraint channels_name_format check (name ~ '^[a-z0-9][a-z0-9-]{0,29}$'),
  constraint channels_topic_length check (char_length(topic) <= 120),
  unique (community_id, name),
  unique (id, community_id)
);

create table public.invites (
  code text primary key default private.gen_invite_code(),
  community_id uuid not null references public.communities (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  max_uses integer,
  uses integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invites_max_uses_range check (max_uses is null or max_uses between 1 and 1000),
  -- Only the generated format can ever be redeemed (join_community lower-cases and trims its input).
  constraint invites_code_format check (code ~ '^[0-9a-f]{16}$')
);
create index invites_community_idx on public.invites (community_id);
create index invites_created_by_idx on public.invites (created_by);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null,
  channel_id uuid not null,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  reply_to uuid,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  hidden_at timestamptz,
  hidden_by uuid references auth.users (id) on delete set null,
  hidden_reason text not null default '',
  links_removed_at timestamptz,
  foreign key (channel_id, community_id) references public.channels (id, community_id) on delete cascade,
  unique (id, channel_id),
  unique (id, community_id),
  foreign key (reply_to, channel_id) references public.messages (id, channel_id),
  constraint messages_body_length check (char_length(body) <= 4000),
  constraint messages_attachments_shape check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 6),
  constraint messages_attachments_size check (octet_length(attachments::text) <= 8000),
  constraint messages_hidden_reason_length check (char_length(hidden_reason) <= 200),
  constraint messages_has_content check (body <> '' or jsonb_array_length(attachments) > 0 or deleted_at is not null or hidden_at is not null)
);
create index messages_channel_created_idx on public.messages (channel_id, created_at desc);
create index messages_reply_to_idx on public.messages (reply_to, channel_id); -- also serves the composite reply FK
create index messages_author_idx on public.messages (author_id);
create index messages_hidden_by_idx on public.messages (hidden_by);
create index messages_channel_community_idx on public.messages (channel_id, community_id); -- the composite channel FK
-- Storage asks "does a visible message reference this file?" for every file a member opens.
create index messages_attachments_idx on public.messages using gin (attachments jsonb_path_ops);

-- Where moderated content goes: only mods can read it, and restoring a message moves it back.
-- (message_id, community_id) must be a real message of that community, so a row can't be planted for someone else's message.
create table public.message_originals (
  message_id uuid primary key,
  community_id uuid not null,
  body text not null,
  attachments jsonb not null,
  saved_by uuid references auth.users (id) on delete set null,
  saved_at timestamptz not null default now(),
  foreign key (message_id, community_id) references public.messages (id, community_id) on delete cascade
);
create index message_originals_community_idx on public.message_originals (community_id);
create index message_originals_saved_by_idx on public.message_originals (saved_by);

create table public.message_reactions (
  message_id uuid not null,
  community_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji),
  foreign key (message_id, community_id) references public.messages (id, community_id) on delete cascade,
  constraint message_reactions_emoji_length check (char_length(emoji) between 1 and 16)
);
create index message_reactions_user_idx on public.message_reactions (user_id);
create index message_reactions_message_idx on public.message_reactions (message_id, community_id); -- the composite message FK
create index message_reactions_community_idx on public.message_reactions (community_id);

-- Slows down guessing invite codes: one row per failed attempt.
create table public.invite_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index invite_attempts_user_at_idx on public.invite_attempts (user_id, at desc);

-- Server-side cache of link previews (written only by the link-preview Edge Function, with the service role).
create table public.link_previews (
  url_hash text primary key,
  url text not null,
  title text,
  description text,
  site text,
  image_path text,
  fetched_at timestamptz not null default now()
);

-- ── membership helpers (used by policies; SECURITY DEFINER so they can read the table the policies protect) ──

create function private.is_member(cid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.community_members m where m.community_id = cid and m.user_id = (select auth.uid())) $$;

create function private.is_mod(cid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.community_members m where m.community_id = cid and m.user_id = (select auth.uid()) and m.role in ('admin', 'mod')) $$;

create function private.is_admin(cid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.community_members m where m.community_id = cid and m.user_id = (select auth.uid()) and m.role = 'admin') $$;

create function private.shares_community(other uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.community_members a join public.community_members b on a.community_id = b.community_id
    where a.user_id = (select auth.uid()) and b.user_id = other
  )
$$;

revoke all on function private.is_member(uuid), private.is_mod(uuid), private.is_admin(uuid), private.shares_community(uuid) from public, anon;
grant execute on function private.is_member(uuid), private.is_mod(uuid), private.is_admin(uuid), private.shares_community(uuid) to authenticated;

-- ── creating a community: the creator becomes its admin and it gets a #general channel ──

create function private.on_community_created() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.communities c where c.created_by = new.created_by) > 10 then
    raise exception 'community_limit' using errcode = 'P0001', hint = 'You can create up to 10 communities.';
  end if;
  insert into public.community_members (community_id, user_id, role) values (new.id, new.created_by, 'admin');
  insert into public.channels (community_id, name, topic) values (new.id, 'general', 'Say hi 👋');
  return new;
end;
$$;
revoke all on function private.on_community_created() from public, anon, authenticated;
create trigger communities_after_insert after insert on public.communities for each row execute function private.on_community_created();

-- ── message rules: who may change what ──

-- Every attachment must be a file in this community's own folder (checked on insert AND when an author edits).
create function private.check_attachments(att jsonb, cid uuid) returns void
language plpgsql set search_path = ''
as $$
declare item jsonb;
begin
  for item in select * from jsonb_array_elements(att) loop
    if jsonb_typeof(item) <> 'object' or (item ->> 'path') is null or (item ->> 'path') not like cid::text || '/%' then
      raise exception 'bad_attachment' using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

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

-- ── bans: banning removes the membership in the same statement, so it can't half-happen ──

create function private.on_ban_created() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.community_members m where m.community_id = new.community_id and m.user_id = new.user_id and m.role <> 'admin';
  return new;
end;
$$;
revoke all on function private.on_ban_created() from public, anon, authenticated;
create trigger community_bans_after_insert after insert on public.community_bans for each row execute function private.on_ban_created();

-- ── sanity limits (a member must not be able to fill the database) ──

create function private.limit_channels() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.channels c where c.community_id = new.community_id) >= 50 then
    raise exception 'channel_limit' using errcode = 'P0001', hint = 'A community can have up to 50 channels.';
  end if;
  return new;
end;
$$;

create function private.limit_invites() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select count(*) from public.invites i where i.community_id = new.community_id) >= 50 then
    raise exception 'invite_limit' using errcode = 'P0001', hint = 'A community can have up to 50 open invites. Revoke some first.';
  end if;
  return new;
end;
$$;

create function private.limit_reactions() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.message_reactions r where r.message_id = new.message_id and r.emoji = new.emoji)
     and (select count(distinct r.emoji) from public.message_reactions r where r.message_id = new.message_id) >= 20 then
    raise exception 'reaction_limit' using errcode = 'P0001', hint = 'A message can have up to 20 different reactions.';
  end if;
  return new;
end;
$$;

revoke all on function private.limit_channels(), private.limit_invites(), private.limit_reactions() from public, anon, authenticated;
create trigger channels_limit before insert on public.channels for each row execute function private.limit_channels();
create trigger invites_limit before insert on public.invites for each row execute function private.limit_invites();
create trigger reactions_limit before insert on public.message_reactions for each row execute function private.limit_reactions();

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
