-- Paste this whole file into the Supabase SQL editor and run it once (Dashboard → SQL Editor → New query).
-- It is the Communities safety migration (supabase/migrations/20261118000100_community_safety.sql), which the automated
-- migration tool declined to apply. It is safe to run twice. Everything else (profile photos, usernames, VibeParty realtime)
-- is already applied.

-- pact: community safety — slowmode, timeouts, admin transfer, and a way to see (and lift) bans.
--
--   * Slowmode: a per-channel minimum gap between one person's messages. Enforced in the insert path with the SERVER clock
--     (a message's created_at is stamped by messages_guard, so a client can't backdate its way around it). Moderators and
--     the admin are exempt. The error is `slowmode:<seconds still to wait>`.
--   * Timeouts: `community_members.timeout_until`. A timed-out member can still read, but can't post or react
--     (`timed_out:<iso time it ends>`), and can't leave-and-rejoin to dodge it. Only `timeout_member()` writes the column
--     (the column isn't in any UPDATE grant), and it enforces who may time out whom.
--   * Admin transfer: `transfer_admin()` swaps the roles in ONE transaction, so a community always has exactly one admin.
--   * Bans: moderators can read the profile of someone they banned (that person no longer shares a community with them,
--     so the ordinary "profiles: read … shared community" policy can't show who it was).
--
-- Re-runnable: columns, constraints, triggers, policies and functions are all created idempotently.

-- ── slowmode ─────────────────────────────────────────────────────────────────

alter table public.channels add column if not exists slowmode_seconds integer not null default 0;
alter table public.channels drop constraint if exists channels_slowmode_range;
alter table public.channels add constraint channels_slowmode_range check (slowmode_seconds between 0 and 21600);

-- "When did this person last post in this channel?" runs on every slowmode insert.
create index if not exists messages_channel_author_idx on public.messages (channel_id, author_id, created_at desc);

-- Moderators may set slowmode (and nothing else on a channel); only the admin renames or re-topics it. (No signed-in user =
-- a server-side context such as the SQL editor or the service role: not a client, so not this rule's business.)
create or replace function private.channels_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and (new.name is distinct from old.name or new.topic is distinct from old.topic)
     and not private.is_admin(old.community_id) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.channels_guard() from public, anon, authenticated;
drop trigger if exists channels_guard_trg on public.channels;
create trigger channels_guard_trg before update on public.channels for each row execute function private.channels_guard();

drop policy if exists "channels: admin edits" on public.channels;
drop policy if exists "channels: mods edit" on public.channels;
create policy "channels: mods edit" on public.channels for update to authenticated
  using (private.is_mod(community_id)) with check (private.is_mod(community_id));
grant update (slowmode_seconds) on table public.channels to authenticated;

-- ── timeouts ─────────────────────────────────────────────────────────────────

alter table public.community_members add column if not exists timeout_until timestamptz;
-- (no UPDATE grant on it: only timeout_member() below writes it)

-- The admin can't be timed out, so whoever becomes the admin starts with a clean slate. (Promotion to moderator doesn't
-- launder a timeout: the admin can lift it explicitly.)
create or replace function private.members_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.role = 'admin' then new.timeout_until := null; end if;
  return new;
end;
$$;

-- Leaving and coming back with an invite would otherwise wipe a timeout. (Moderators can still remove or ban the person;
-- the community being deleted, or an account being deleted, isn't "the member leaving" and is unaffected.)
create or replace function private.members_leave_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.user_id = (select auth.uid()) and old.role <> 'admin' and old.timeout_until is not null and old.timeout_until > clock_timestamp() then
    raise exception 'timed_out:%', to_char(old.timeout_until at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') using errcode = 'P0001';
  end if;
  return old;
end;
$$;
revoke all on function private.members_guard(), private.members_leave_guard() from public, anon, authenticated;
drop trigger if exists members_guard_trg on public.community_members;
create trigger members_guard_trg before update on public.community_members for each row execute function private.members_guard();
drop trigger if exists members_leave_guard_trg on public.community_members;
create trigger members_leave_guard_trg before delete on public.community_members for each row execute function private.members_leave_guard();

-- Raises `timed_out:<iso>` if `who` is a timed-out member of the community.
create or replace function private.enforce_timeout(cid uuid, who uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare t_until timestamptz;
begin
  select m.timeout_until into t_until from public.community_members m where m.community_id = cid and m.user_id = who and m.role <> 'admin';
  if t_until is not null and t_until > clock_timestamp() then
    raise exception 'timed_out:%', to_char(t_until at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') using errcode = 'P0001';
  end if;
end;
$$;

-- Raises `slowmode:<seconds to wait>` if `who` (a plain member) posted in this channel less than its slowmode ago.
create or replace function private.enforce_slowmode(cid uuid, chid uuid, who uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  gap integer;
  last_at timestamptz;
  wait_s numeric;
begin
  select c.slowmode_seconds into gap from public.channels c where c.id = chid and c.community_id = cid;
  if coalesce(gap, 0) = 0 or private.is_mod(cid) then return; end if;
  -- Two sends by the same person at the same instant must not both slip through: take turns.
  perform pg_advisory_xact_lock(hashtextextended(chid::text || ':' || who::text, 0));
  -- Every message counts, including ones since deleted or hidden (they are tombstoned, never erased).
  select max(m.created_at) into last_at from public.messages m where m.channel_id = chid and m.author_id = who;
  if last_at is not null then
    wait_s := extract(epoch from (last_at + make_interval(secs => gap) - clock_timestamp()));
    if wait_s > 0 then raise exception 'slowmode:%', ceil(wait_s)::integer using errcode = 'P0001'; end if;
  end if;
end;
$$;
revoke all on function private.enforce_timeout(uuid, uuid), private.enforce_slowmode(uuid, uuid, uuid) from public, anon, authenticated;

-- The messages guard again (see 20261117000100), with the posting rules added to the INSERT branch.
create or replace function private.messages_guard() returns trigger
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
    -- Posting rules. Only for a real member posting as themselves: anyone else is about to be refused by row level security,
    -- and shouldn't learn anything (when someone last posted, whether a channel exists) from which rule they hit first.
    if uid is not null and new.author_id = uid and private.is_member(new.community_id) then
      perform private.enforce_timeout(new.community_id, uid);
      perform private.enforce_slowmode(new.community_id, new.channel_id, uid);
    end if;
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
revoke all on function private.messages_guard() from public, anon, authenticated;

-- A timed-out member can't add reactions either.
create or replace function private.reactions_timeout_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.user_id = (select auth.uid()) then perform private.enforce_timeout(new.community_id, new.user_id); end if;
  return new;
end;
$$;
revoke all on function private.reactions_timeout_guard() from public, anon, authenticated;
drop trigger if exists reactions_timeout on public.message_reactions;
create trigger reactions_timeout before insert on public.message_reactions for each row execute function private.reactions_timeout_guard();

-- Time a member out (p_seconds > 0, at most 28 days) or lift it (0). Returns when it ends (NULL when lifted).
--   the admin   → mods and members      a moderator → ordinary members only      nobody → the admin or themselves
create or replace function public.timeout_member(p_community uuid, p_user uuid, p_seconds integer) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  mine text;
  theirs text;
  t_until timestamptz;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  if p_seconds is null or p_seconds < 0 or p_seconds > 2419200 then raise exception 'bad_duration' using errcode = 'P0001'; end if;
  select m.role into mine from public.community_members m where m.community_id = p_community and m.user_id = uid;
  if mine is null or mine not in ('admin', 'mod') or p_user = uid then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  select m.role into theirs from public.community_members m where m.community_id = p_community and m.user_id = p_user;
  if theirs is null then raise exception 'not_a_member' using errcode = 'P0001'; end if;
  if theirs = 'admin' or (theirs = 'mod' and mine <> 'admin') then raise exception 'not_allowed' using errcode = 'P0001'; end if;
  t_until := case when p_seconds = 0 then null else clock_timestamp() + make_interval(secs => p_seconds) end;
  update public.community_members m set timeout_until = t_until where m.community_id = p_community and m.user_id = p_user;
  return t_until;
end;
$$;

-- ── admin transfer ───────────────────────────────────────────────────────────
-- The caller (the admin) becomes a moderator and a current member becomes the admin — in one transaction, so the community
-- is never without an admin (and, with the one-admin unique index, never has two). The community's `created_by` follows the
-- admin: it is what cascades the community away when an account is deleted, so the original creator deleting their account
-- no longer takes a community they handed over with them.

create or replace function public.transfer_admin(p_community uuid, p_new_admin uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  theirs text;
begin
  if uid is null then raise exception 'not_signed_in' using errcode = 'P0001'; end if;
  -- Two transfers (or a transfer and anything else that changes the community) take turns.
  perform 1 from public.communities c where c.id = p_community for no key update;
  if not exists (select 1 from public.community_members m where m.community_id = p_community and m.user_id = uid and m.role = 'admin')
     or p_new_admin = uid then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.community_bans b where b.community_id = p_community and b.user_id = p_new_admin) then
    raise exception 'banned' using errcode = 'P0001';
  end if;
  select m.role into theirs from public.community_members m where m.community_id = p_community and m.user_id = p_new_admin;
  if theirs is null then raise exception 'not_a_member' using errcode = 'P0001'; end if;
  update public.community_members m set role = 'mod' where m.community_id = p_community and m.user_id = uid;
  update public.community_members m set role = 'admin' where m.community_id = p_community and m.user_id = p_new_admin;
  update public.communities c set created_by = p_new_admin where c.id = p_community;
end;
$$;

revoke all on function public.timeout_member(uuid, uuid, integer), public.transfer_admin(uuid, uuid) from public, anon;
grant execute on function public.timeout_member(uuid, uuid, integer), public.transfer_admin(uuid, uuid) to authenticated;

-- ── seeing who is banned ─────────────────────────────────────────────────────
-- Banning removes the membership, so the banned person no longer shares a community with the moderators and the ordinary
-- profile policy hides them. Moderators of a community may read the (public) profile of anyone banned from it — and of
-- whoever issued the ban, who may since have left.

create or replace function private.moderates_ban_of(pid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.community_bans b join public.community_members m on m.community_id = b.community_id
    where (b.user_id = pid or b.banned_by = pid) and m.user_id = (select auth.uid()) and m.role in ('admin', 'mod')
  )
$$;
revoke all on function private.moderates_ban_of(uuid) from public, anon;
grant execute on function private.moderates_ban_of(uuid) to authenticated;

-- A separate policy rather than an edit of the existing one: permissive policies are OR-ed.
drop policy if exists "profiles: moderators read people banned from their community" on public.profiles;
create policy "profiles: moderators read people banned from their community" on public.profiles for select to authenticated
  using (private.moderates_ban_of(id));
