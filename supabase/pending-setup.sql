-- Paste this whole file into the Supabase SQL editor and run it once (Dashboard → SQL Editor → New query).
-- It is supabase/migrations/20261119000000_profile_identity.sql: social links on profiles, a username that is fixed after the
-- welcome form, and an email that comes from the sign-in and is read-only. Safe to run twice. (The earlier contents of this
-- file, the Communities safety migration, have already been applied.)

-- Identity: a username that is chosen once and then fixed, an email that comes from the sign-in (never typed, never
-- changed here), and up to five social links on the profile.

-- ── social links ─────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists links jsonb not null default '[]'::jsonb;

-- [{ "kind": "instagram", "url": "https://instagram.com/…" }, …] — at most 5, only known platforms, https only, and the
-- address must really be on that platform (so a "github" link can't point somewhere else). "website" is any https address.
create or replace function private.valid_links(l jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  e jsonb;
  k text;
  u text;
  host_re text;
begin
  if l is null or jsonb_typeof(l) <> 'array' or jsonb_array_length(l) > 5 then return false; end if;
  for e in select * from jsonb_array_elements(l) loop
    if jsonb_typeof(e) <> 'object' or (select count(*) from jsonb_object_keys(e)) <> 2 then return false; end if;
    k := e ->> 'kind';
    u := e ->> 'url';
    if k is null or u is null or char_length(u) > 200 or u !~* '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(:443)?(/[^[:space:]]*)?$' then return false; end if;
    host_re := case k
      when 'instagram' then '(?:[a-z0-9-]+\.)?instagram\.com'
      when 'facebook' then '(?:[a-z0-9-]+\.)?(?:facebook\.com|fb\.com|fb\.me)'
      when 'x' then '(?:[a-z0-9-]+\.)?(?:x\.com|twitter\.com)'
      when 'snapchat' then '(?:[a-z0-9-]+\.)?snapchat\.com'
      when 'pinterest' then '(?:[a-z0-9-]+\.)?(?:pinterest\.[a-z.]{2,}|pin\.it)'
      when 'linkedin' then '(?:[a-z0-9-]+\.)?linkedin\.com'
      when 'github' then '(?:[a-z0-9-]+\.)?github\.com'
      when 'youtube' then '(?:[a-z0-9-]+\.)?(?:youtube\.com|youtu\.be)'
      when 'tiktok' then '(?:[a-z0-9-]+\.)?tiktok\.com'
      when 'threads' then '(?:[a-z0-9-]+\.)?threads\.(?:net|com)'
      when 'reddit' then '(?:[a-z0-9-]+\.)?reddit\.com'
      when 'twitch' then '(?:[a-z0-9-]+\.)?twitch\.tv'
      when 'discord' then '(?:[a-z0-9-]+\.)?(?:discord\.gg|discord\.com)'
      when 'telegram' then '(?:[a-z0-9-]+\.)?(?:t\.me|telegram\.me)'
      when 'website' then '[^/]+'
      else null
    end;
    if host_re is null or u !~* ('^https://' || host_re || '(?::443)?(?:/|$)') then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function private.valid_links(jsonb) from public, anon, authenticated;

-- ── the username is fixed once the welcome flow is done ──────────────────────
-- A new account gets a random suggested name; the welcome form is where the person picks theirs (and sets `onboarded`
-- in the same update). After that the name can't be changed — by this app or by anyone calling the API directly.

create or replace function private.profiles_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.onboarded and new.username is distinct from old.username then
    raise exception 'username_locked' using errcode = 'P0001';
  end if;
  if not private.valid_links(new.links) then
    raise exception 'invalid_links' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.profiles_guard() from public, anon, authenticated;
drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg before insert or update on public.profiles for each row execute function private.profiles_guard();

-- ── the email is the sign-in's, and read-only ────────────────────────────────

create or replace function private.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
begin
  base := lower(regexp_replace(
    coalesce(
      nullif(new.raw_user_meta_data ->> 'user_name', ''),
      nullif(new.raw_user_meta_data ->> 'preferred_username', ''),
      'user' || substr(md5(random()::text || clock_timestamp()::text), 1, 6)
    ),
    '[^a-zA-Z0-9_]', '', 'g'));
  if char_length(base) < 3 then
    base := 'user' || base;
  end if;
  base := left(base, 15);
  candidate := base;
  while exists (select 1 from public.profiles p where p.username = candidate) loop
    candidate := base || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
  end loop;

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    candidate,
    left(coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), ''), 40)
  )
  on conflict (id) do nothing;
  insert into public.profile_private (id, contact_email) values (new.id, left(new.email, 120)) on conflict (id) do nothing;
  return new;
end;
$$;

-- everyone who already signed in gets the email their sign-in has
insert into public.profile_private (id, contact_email)
select u.id, left(u.email, 120) from auth.users u where u.email is not null
on conflict (id) do update set contact_email = excluded.contact_email;

-- read-only for people: only the sign-up trigger (and the service) write it
drop policy if exists "profile_private: insert own" on public.profile_private;
drop policy if exists "profile_private: update own" on public.profile_private;
revoke insert, update on table public.profile_private from authenticated;
