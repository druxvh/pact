-- Paste this whole file into the Supabase SQL editor and run it once (Dashboard → SQL Editor → New query).
-- It holds every migration the hosted project still lacks, in order, and is safe to run twice:
--   1. supabase/migrations/20261119000000_profile_identity.sql — social links on profiles, a username that is fixed after the
--      welcome form, and an email that comes from the sign-in and is read-only.
--   2. supabase/migrations/20261119100000_now_playing.sql — "Now playing": the `now_playing` table, who may see it
--      (`profiles.now_playing_visibility`, default off), the `now_playing_for()` function and its Realtime publication. Until this
--      is applied the app works as before and the feature quietly shows nothing for other people.
--   3. supabase/migrations/20261120000000_activity.sql — "Activity": 24-hour notes (`status_notes`, who may see them in
--      `profiles.notes_visibility`, default "communities"), hearts on notes and on the song someone is listening to
--      (`activity_likes`), public comments under notes (`activity_comments`), and the small real inbox of likes / comments /
--      replies (`activity_messages`), with the `activity_feed()` and `activity_engagement()` functions and their Realtime
--      publication. It needs (2). Until this is applied the app works as before and Activity quietly shows nothing.
-- (The earlier contents of this file — the Communities safety migration — have already been applied.)

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 1 / 3 — 20261119000000_profile_identity.sql
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

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

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 2 / 3 — 20261119100000_now_playing.sql
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- pact: "Now playing" — what a person is listening to in a web player in their own browser, shown live to the people they chose.
--
-- Model
--   * The extension reads the title / artist / artwork of the track that is playing in an open music tab (only when the person
--     turned that on), and — only if they also chose to share — writes it here. One row per person (`user_id` is the primary
--     key): the track playing right now, nothing else. There is no history. The row is refreshed every ~30 s while music plays
--     and deleted when it stops, when sharing is turned off and when the account goes.
--   * WHO may see it is a per-person setting on their profile, `profiles.now_playing_visibility`: `off` (the default — nothing
--     can be written), `communities` (people who share a community with them) or `everyone` (any signed-in person). Setting it
--     to `off` deletes the row, in the database, whatever client asked.
--   * Others only ever see a FRESH row: updated within the last 2 minutes by the server's clock. If the browser crashes or the
--     laptop closes, the person stops being "listening" by themselves — nobody has to delete anything. Stale rows are also swept
--     by the next write of anyone, so a crashed browser's last track doesn't sit in the table for ever.
--
-- Security notes
--   * Everything in a row came from someone else's browser: treat it as hostile. The database refuses what no music player would
--     send — over-long text, control / invisible / bidi characters, an unknown `source`, and any `artwork_url` / `track_url` that
--     isn't https on the player's OWN hosts (see `private.np_hosts`). The artwork rule matters most: a free-form image address
--     would let one person log the IP address of everyone who opens their profile card. src/features/nowplaying/hosts.ts keeps
--     the same lists (a test compares the two) and checks again before any address reaches an <img> or a link.
--   * `updated_at` is stamped by the server (never the client's clock) and isn't writable: column grants leave it out, and the
--     guard trigger overwrites it anyway. Writes are rate-limited per person (20 upserts a minute; a heartbeat is 2).
--   * RLS on the table; `anon` has no access. The helpers live in the unexposed `private` schema and pin `search_path`.
--   * Safe to run twice (it is also pasted into the SQL editor from supabase/pending-setup.sql).

grant usage on schema private to authenticated;

-- ── who may see it ───────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists now_playing_visibility text not null default 'off'
  constraint profiles_now_playing_visibility check (now_playing_visibility in ('off', 'communities', 'everyone'));

-- ── row validation (pure helpers; EXECUTE granted because the CHECK constraints run as the caller) ──

-- The hosts a player's own pages ('track') and images ('artwork') may be on. A host matches exactly or as a real subdomain
-- (`i.scdn.co` for `scdn.co`) — never by containing the name (`scdn.co.evil.example`, `evil.example/scdn.co`).
create or replace function private.np_hosts(src text, kind text) returns text[]
language sql immutable set search_path = ''
as $$
  select case kind || ':' || src
    when 'track:spotify' then array['open.spotify.com']
    when 'track:youtube-music' then array['music.youtube.com']
    when 'track:soundcloud' then array['soundcloud.com']
    when 'track:apple-music' then array['music.apple.com']
    when 'track:deezer' then array['deezer.com']
    when 'track:tidal' then array['tidal.com']
    when 'artwork:spotify' then array['scdn.co', 'spotifycdn.com']
    when 'artwork:youtube-music' then array['googleusercontent.com', 'ytimg.com', 'ggpht.com']
    when 'artwork:soundcloud' then array['sndcdn.com']
    when 'artwork:apple-music' then array['mzstatic.com']
    when 'artwork:deezer' then array['dzcdn.net']
    when 'artwork:tidal' then array['tidal.com']
    else array[]::text[]
  end
$$;

-- https only, no credentials, no odd port, no spaces or control characters, at most 500 characters, and the host is one of
-- the source's own. (The host is read with a strict pattern: a trailing dot, `user@host`, or a path that looks like a host
-- all fail to match at all.)
create or replace function private.np_url_ok(u text, src text, kind text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(
    char_length(u) <= 500
    and exists (
      select 1
      from (select substring(lower(u) from '^https://((?:[a-z0-9-]+\.)+[a-z]{2,})(?::443)?(?:[/?#][^[:space:][:cntrl:]]*)?$') as h) x,
           unnest(private.np_hosts(src, kind)) as allowed
      where x.h is not null and (x.h = allowed or x.h like '%.' || allowed)
    ),
    false
  )
$$;

-- No control characters, line / paragraph separators, zero-width characters or bidi overrides (the last kind lets a title
-- render as something it is not). Built from code points so the pattern holds no invisible character.
create or replace function private.np_text_ok(t text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(
    t !~ ('[' || chr(1) || '-' || chr(31) || chr(127) || '-' || chr(159) || chr(8203) || '-' || chr(8207)
          || chr(8232) || '-' || chr(8238) || chr(8288) || '-' || chr(8297) || chr(65279) || ']'),
    false
  )
$$;

grant execute on function private.np_hosts(text, text), private.np_url_ok(text, text, text), private.np_text_ok(text) to authenticated;

-- ── the table ────────────────────────────────────────────────────────────────

create table if not exists public.now_playing (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  title text not null,
  artist text not null default '',
  album text not null default '',
  artwork_url text,
  track_url text,
  source text not null,
  updated_at timestamptz not null default now(),
  constraint now_playing_title_length check (char_length(btrim(title)) between 1 and 150),
  constraint now_playing_artist_length check (char_length(artist) <= 150),
  constraint now_playing_album_length check (char_length(album) <= 150),
  constraint now_playing_text_clean check (private.np_text_ok(title) and private.np_text_ok(artist) and private.np_text_ok(album)),
  constraint now_playing_source check (source in ('spotify', 'youtube-music', 'soundcloud', 'apple-music', 'deezer', 'tidal')),
  constraint now_playing_artwork check (artwork_url is null or private.np_url_ok(artwork_url, source, 'artwork')),
  constraint now_playing_track check (track_url is null or private.np_url_ok(track_url, source, 'track'))
);
create index if not exists now_playing_updated_idx on public.now_playing (updated_at);

alter table public.now_playing enable row level security;

-- ── helpers used by the policies (SECURITY DEFINER: they read profiles / memberships on the caller's behalf) ──

-- Has the signed-in person chosen to share at all?
create or replace function private.np_sharing() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.now_playing_visibility <> 'off') $$;

-- May the signed-in person see what `owner` is listening to? (Freshness is checked by the policy itself.)
create or replace function private.np_can_see(owner uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = owner
      and (p.now_playing_visibility = 'everyone' or (p.now_playing_visibility = 'communities' and private.shares_community(owner)))
  )
$$;

revoke all on function private.np_sharing(), private.np_can_see(uuid) from public, anon;
grant execute on function private.np_sharing(), private.np_can_see(uuid) to authenticated;

-- ── row guard: server clock, rate limit, tidy-up ─────────────────────────────

create table if not exists private.now_playing_writes (
  user_id uuid primary key references auth.users (id) on delete cascade,
  window_start timestamptz not null,
  writes integer not null
);
revoke all on table private.now_playing_writes from public, anon, authenticated;

create or replace function private.now_playing_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'immutable_column' using errcode = 'P0001';
  end if;

  -- the server's clock, always: a client can't claim a track is fresher (or older) than it is
  new.updated_at := now();
  new.title := btrim(new.title);
  new.artist := btrim(new.artist);
  new.album := btrim(new.album);
  new.artwork_url := nullif(btrim(new.artwork_url), '');
  new.track_url := nullif(btrim(new.track_url), '');

  -- At most 20 upserts a minute per person (a heartbeat is 2; skipping through songs is debounced by the extension). An upsert
  -- that finds its row fires this trigger twice — once as the INSERT, once as the UPDATE — so the counter allows 40.
  insert into private.now_playing_writes as w (user_id, window_start, writes)
  values (new.user_id, now(), 1)
  on conflict (user_id) do update set
    window_start = case when w.window_start < now() - interval '1 minute' then now() else w.window_start end,
    writes = case when w.window_start < now() - interval '1 minute' then 1 else w.writes + 1 end
  returning writes into n;
  if n > 40 then
    raise exception 'rate_limited' using errcode = 'P0001', hint = 'Too many updates — wait a minute.';
  end if;

  -- every insert (so every upsert) sweeps away rows nobody refreshed for ten minutes (a closed laptop, a crash)
  if tg_op = 'INSERT' then
    delete from public.now_playing where updated_at < now() - interval '10 minutes';
  end if;
  return new;
end;
$$;
revoke all on function private.now_playing_guard() from public, anon, authenticated;
drop trigger if exists now_playing_guard_trg on public.now_playing;
create trigger now_playing_guard_trg before insert or update on public.now_playing for each row execute function private.now_playing_guard();

-- Turning sharing off deletes what was shared — here, in the database, not left to the client to remember.
create or replace function private.now_playing_visibility_changed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.now_playing_visibility = 'off' then
    delete from public.now_playing where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.now_playing_visibility_changed() from public, anon, authenticated;
drop trigger if exists profiles_now_playing_off_trg on public.profiles;
create trigger profiles_now_playing_off_trg
  after update of now_playing_visibility on public.profiles
  for each row when (old.now_playing_visibility is distinct from new.now_playing_visibility)
  execute function private.now_playing_visibility_changed();

-- ── policies ─────────────────────────────────────────────────────────────────

drop policy if exists "now_playing: read own" on public.now_playing;
create policy "now_playing: read own" on public.now_playing for select to authenticated using ((select auth.uid()) = user_id);

-- Everyone else: a fresh row (the server's clock, last 2 minutes) of someone who lets them see it.
drop policy if exists "now_playing: read fresh and shared" on public.now_playing;
create policy "now_playing: read fresh and shared" on public.now_playing for select to authenticated
  using (updated_at > now() - interval '2 minutes' and private.np_can_see(user_id));

-- Writing needs sharing to be on, and only ever your own row.
drop policy if exists "now_playing: write own" on public.now_playing;
create policy "now_playing: write own" on public.now_playing for insert to authenticated
  with check ((select auth.uid()) = user_id and private.np_sharing());
drop policy if exists "now_playing: update own" on public.now_playing;
create policy "now_playing: update own" on public.now_playing for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and private.np_sharing());
drop policy if exists "now_playing: delete own" on public.now_playing;
create policy "now_playing: delete own" on public.now_playing for delete to authenticated using ((select auth.uid()) = user_id);

-- `updated_at` is not in the lists: it is the server's alone.
revoke all on table public.now_playing from anon, authenticated;
grant select, delete on table public.now_playing to authenticated;
grant insert (user_id, title, artist, album, artwork_url, track_url, source) on table public.now_playing to authenticated;
grant update (user_id, title, artist, album, artwork_url, track_url, source) on table public.now_playing to authenticated;

-- ── reading, with ages ───────────────────────────────────────────────────────

-- What the people on screen are listening to, with how old each row is *by the server's clock* — so a viewer's wrong system
-- clock can't make a stale track look fresh. SECURITY INVOKER: the policies above decide which rows come back. At most 100 ids.
create or replace function public.now_playing_for(p_ids uuid[])
returns table (user_id uuid, title text, artist text, album text, artwork_url text, track_url text, source text, age_seconds integer)
language sql stable security invoker set search_path = ''
as $$
  select n.user_id, n.title, n.artist, n.album, n.artwork_url, n.track_url, n.source,
         greatest(0, extract(epoch from now() - n.updated_at))::integer as age_seconds
  from public.now_playing n
  where n.user_id = any (p_ids[1:100])
$$;
revoke all on function public.now_playing_for(uuid[]) from public, anon;
grant execute on function public.now_playing_for(uuid[]) to authenticated;

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- postgres_changes respects the policies above: a viewer is only sent rows they could select. (DELETE events carry no row
-- to check and are not relied on: viewers also expire rows by age.)

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'now_playing') then
    alter publication supabase_realtime add table public.now_playing;
  end if;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 3 / 3 — 20261120000000_activity.sql
-- ═════════════════════════════════════════════════════════════════════════════════════════════════

-- pact: Activity — 24-hour notes, hearts on notes and on the song someone is listening to, public comments under notes, and a
-- small REAL inbox ("activity messages") that carries likes, comments and private replies.
--
-- Model
--   * A NOTE is a short line (≤ 60 characters) and/or one song a person pins for 24 hours (`status_notes`, one row per person).
--     Posting again replaces it: the row gets a new id and a fresh 24 hours, and the comments and hearts of the old note go with
--     it. Expired notes are invisible at once (the policies compare `expires_at` with the server's clock) and are deleted by the
--     next note anyone posts. Unlike the live "listening now" row, a note is something the person explicitly wrote, so it may be
--     kept for a day. There is still no listening history anywhere.
--   * WHO may see a person's notes is `profiles.notes_visibility`: `off`, `communities` (default — people who share a community
--     with them) or `everyone` (any signed-in person). Setting it to `off` deletes the note, in the database. The live song uses
--     the existing `profiles.now_playing_visibility` (a heart on a song needs that song to be visible to the person giving it).
--   * A LIKE (`activity_likes`) is a heart on a note (the subject is the note's id) or on the song someone is listening to now
--     (the subject is a key for the song). One per person per subject; never on yourself; you must be allowed to see the thing.
--     Only the person who gave it and the owner can read a like row — everyone else gets COUNTS (`activity_engagement`), never
--     names. Un-liking deletes the row.
--   * A COMMENT (`activity_comments`) is public text under a note: anyone who can see the note can read it; its author and the
--     note's owner can delete it. Comments die with their note.
--   * An ACTIVITY MESSAGE (`activity_messages`) is what lands in the recipient's inbox: a `like`, a `comment` or a `reply`, with a
--     SNAPSHOT of what it is about (`context`: the note's text and song, or the song) so it still makes sense after the note has
--     expired or the song has changed. Likes and comments are written ONLY by triggers on `activity_likes` / `activity_comments`
--     (so nobody can forge one); for a like or a comment the snapshot is built by the database from the note — or, for a song, from
--     the owner's Now playing row — never taken from the client. Clients may write only `reply` (whose snapshot is their own claim,
--     validated like all text), to someone whose note or song they can see or who already wrote to them. The recipient can mark
--     messages read and delete them.
--   * Retention: notes 24 hours; a like until it is taken back (or its note is replaced, expires or is deleted); a comment with its
--     note; an activity message until its recipient deletes it; everything of a person when their account is deleted.
--
-- Security notes
--   * Everything in a row came from someone else's browser: treat it as hostile. The database refuses what no honest client would
--     send — over-long text, control / invisible / bidi characters, and any song address that isn't https on the music service's OWN
--     hosts (the same `private.np_*` helpers as Now playing; an image address a person could choose would let them log the IP of
--     everyone who opens their note). No HTML is stored or produced anywhere: every field is plain text, rendered as text.
--   * Timestamps (`created_at`, `expires_at`, `read_at`) are stamped by the server and are not writable: column grants leave them
--     out and the guard triggers overwrite them anyway. Writes are rate-limited per person (10 notes / 60 likes / 30 comments /
--     30 replies an hour). Ids that identify a note are generated by the database.
--   * Column grants are minimal (a client cannot name a sender, an author, an actor, a kind of message other than the default
--     `reply`, a timestamp, an expiry). RLS is on every table; `anon` has nothing; no function here is executable by `anon`.
--     Helpers used by policies live in the unexposed `private` schema, SECURITY DEFINER only where a rule must read what the caller
--     can't (profiles, memberships, other people's likes), each pinning `search_path`.
--   * The two public RPCs return only what the caller may already see (their own rows, or counts about things they can see).
--   * Realtime: `status_notes`, `activity_messages` and `activity_likes` are published; postgres_changes respects the SELECT policies
--     (a person is only sent rows they could select). DELETE events carry only the primary key and are not relied on.
--   * Safe to run twice (it is also pasted into the SQL editor from supabase/pending-setup.sql). Needs the Now playing migration.

grant usage on schema private to authenticated;

-- ── who may see a person's notes ─────────────────────────────────────────────

alter table public.profiles
  add column if not exists notes_visibility text not null default 'communities'
  constraint profiles_notes_visibility check (notes_visibility in ('off', 'communities', 'everyone'));

-- ── validation of the "what was liked / replied to" snapshot (pure; EXECUTE granted because CHECKs run as the caller) ──

-- A song as stored in a snapshot: camelCase keys like the app's Track; every address through the same allow-list as Now playing.
create or replace function private.act_track_ok(t jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  k text;
  v jsonb;
  src text;
begin
  if t is null or jsonb_typeof(t) <> 'object' then return false; end if;
  for k in select jsonb_object_keys(t) loop
    if k not in ('title', 'artist', 'album', 'artworkUrl', 'trackUrl', 'source') then return false; end if;
  end loop;

  if jsonb_typeof(t -> 'source') is distinct from 'string' then return false; end if;
  src := t ->> 'source';
  if src not in ('spotify', 'youtube-music', 'soundcloud', 'apple-music', 'deezer', 'tidal') then return false; end if;

  if jsonb_typeof(t -> 'title') is distinct from 'string' then return false; end if;
  if char_length(btrim(t ->> 'title')) not between 1 and 150 or not private.np_text_ok(t ->> 'title') then return false; end if;

  foreach k in array array['artist', 'album'] loop
    v := t -> k;
    if v is not null and (jsonb_typeof(v) <> 'string' or char_length(t ->> k) > 150 or not private.np_text_ok(t ->> k)) then return false; end if;
  end loop;

  foreach k in array array['artworkUrl', 'trackUrl'] loop
    v := t -> k;
    if v is not null and jsonb_typeof(v) <> 'null' then
      if jsonb_typeof(v) <> 'string' or not private.np_url_ok(t ->> k, src, case k when 'artworkUrl' then 'artwork' else 'track' end) then return false; end if;
    end if;
  end loop;
  return true;
end;
$$;

-- { kind: 'note' | 'listening', text?: ≤ 60 chars, track?: { … } } and nothing else.
create or replace function private.act_context_ok(c jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  k text;
begin
  if c is null or jsonb_typeof(c) <> 'object' then return false; end if;
  for k in select jsonb_object_keys(c) loop
    if k not in ('kind', 'text', 'track') then return false; end if;
  end loop;
  if jsonb_typeof(c -> 'kind') is distinct from 'string' or (c ->> 'kind') not in ('note', 'listening') then return false; end if;
  if c -> 'text' is not null and (jsonb_typeof(c -> 'text') <> 'string' or char_length(c ->> 'text') > 60 or not private.np_text_ok(c ->> 'text')) then
    return false;
  end if;
  if c -> 'track' is not null and not private.act_track_ok(c -> 'track') then return false; end if;
  return true;
end;
$$;

revoke all on function private.act_track_ok(jsonb), private.act_context_ok(jsonb) from public, anon;
grant execute on function private.act_track_ok(jsonb), private.act_context_ok(jsonb) to authenticated;

-- ── tables ───────────────────────────────────────────────────────────────────

-- One note per person. `id` is new for every posting (likes and comments point at a specific posting).
create table if not exists public.status_notes (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  body text not null default '',
  track_title text,
  track_artist text,
  track_album text,
  track_artwork_url text,
  track_url text,
  track_source text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  constraint status_notes_body_length check (char_length(body) <= 60),
  constraint status_notes_body_clean check (private.np_text_ok(body)),
  -- a note says something, or plays something
  constraint status_notes_not_empty check (char_length(body) > 0 or track_title is not null),
  -- a track is all or nothing: a title and a known service, or none of the track columns
  constraint status_notes_track_shape check (
    (track_title is not null and track_source is not null)
    or (track_title is null and track_source is null and track_artist is null and track_album is null and track_artwork_url is null and track_url is null)
  ),
  constraint status_notes_track_title check (track_title is null or (char_length(btrim(track_title)) between 1 and 150 and private.np_text_ok(track_title))),
  constraint status_notes_track_artist check (track_artist is null or (char_length(track_artist) <= 150 and private.np_text_ok(track_artist))),
  constraint status_notes_track_album check (track_album is null or (char_length(track_album) <= 150 and private.np_text_ok(track_album))),
  constraint status_notes_track_source check (track_source is null or track_source in ('spotify', 'youtube-music', 'soundcloud', 'apple-music', 'deezer', 'tidal')),
  constraint status_notes_track_artwork check (track_artwork_url is null or private.np_url_ok(track_artwork_url, track_source, 'artwork')),
  constraint status_notes_track_link check (track_url is null or private.np_url_ok(track_url, track_source, 'track'))
);
create index if not exists status_notes_expires_idx on public.status_notes (expires_at);
create index if not exists status_notes_created_idx on public.status_notes (created_at desc);

-- A heart. `subject_key` is the note's id (kind 'note') or a key for the song (kind 'listening').
create table if not exists public.activity_likes (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  subject_key text not null,
  context jsonb not null,
  created_at timestamptz not null default now(),
  constraint activity_likes_kind check (kind in ('note', 'listening')),
  constraint activity_likes_key check (char_length(subject_key) between 1 and 200 and private.np_text_ok(subject_key)),
  constraint activity_likes_no_self check (actor_id <> owner_id),
  constraint activity_likes_context check (private.act_context_ok(context)),
  constraint activity_likes_context_kind check (context ->> 'kind' = kind),
  constraint activity_likes_listening_song check (kind <> 'listening' or (context -> 'track') is not null),
  constraint activity_likes_once unique (actor_id, owner_id, kind, subject_key)
);
create index if not exists activity_likes_subject_idx on public.activity_likes (owner_id, kind, subject_key);

-- Public text under a note (`subject_key` = the note's id).
create table if not exists public.activity_comments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  subject_key text not null,
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint activity_comments_key check (char_length(subject_key) between 1 and 200),
  constraint activity_comments_body check (char_length(body) between 1 and 200 and private.np_text_ok(body))
);
create index if not exists activity_comments_subject_idx on public.activity_comments (owner_id, subject_key, created_at);
create index if not exists activity_comments_author_idx on public.activity_comments (author_id);

-- The inbox. `subject_kind` / `subject_key` are written by the triggers only (they make "one message per like" possible).
create table if not exists public.activity_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'reply',
  body text not null default '',
  context jsonb,
  subject_kind text,
  subject_key text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint activity_messages_kind check (kind in ('like', 'comment', 'reply')),
  constraint activity_messages_no_self check (sender_id <> recipient_id),
  constraint activity_messages_body check (
    (kind = 'like' and body = '') or (kind <> 'like' and char_length(body) between 1 and 500 and private.np_text_ok(body))
  ),
  constraint activity_messages_context check (context is null or private.act_context_ok(context)),
  constraint activity_messages_like_context check (kind <> 'like' or context is not null),
  constraint activity_messages_subject check (
    (subject_kind is null or subject_kind in ('note', 'listening')) and (subject_key is null or char_length(subject_key) between 1 and 200)
  ),
  constraint activity_messages_like_subject check (kind <> 'like' or (subject_kind is not null and subject_key is not null))
);
create index if not exists activity_messages_recipient_idx on public.activity_messages (recipient_id, created_at desc);
create index if not exists activity_messages_sender_idx on public.activity_messages (sender_id, created_at desc);
-- A person's heart on one thing notifies its owner once, however often it is taken back and given again.
create unique index if not exists activity_messages_like_once on public.activity_messages (sender_id, recipient_id, subject_kind, subject_key) where kind = 'like';

alter table public.status_notes enable row level security;
alter table public.activity_likes enable row level security;
alter table public.activity_comments enable row level security;
alter table public.activity_messages enable row level security;

-- ── rate limiting (a fixed window per person and kind of write) ──────────────

create table if not exists private.activity_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  n integer not null,
  last_tx bigint not null,
  primary key (user_id, bucket)
);
revoke all on table private.activity_limits from public, anon, authenticated;

-- Counts one write and refuses it (rolling everything back, the count included) when the window is full. `p_same_tx_free`: an upsert
-- that finds its row fires the guard twice in one transaction (as the INSERT, then as the UPDATE) — only the first firing counts.
create or replace function private.act_rate(p_uid uuid, p_bucket text, p_max integer, p_window interval, p_same_tx_free boolean default false) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  tx bigint := txid_current();
  c integer;
begin
  insert into private.activity_limits as l (user_id, bucket, window_start, n, last_tx)
  values (p_uid, p_bucket, now(), 1, tx)
  on conflict (user_id, bucket) do update set
    window_start = case when l.window_start <= now() - p_window then now() else l.window_start end,
    n = case
      when l.window_start <= now() - p_window then 1
      when p_same_tx_free and l.last_tx = tx then l.n
      else l.n + 1
    end,
    last_tx = tx
  returning n into c;
  if c > p_max then
    raise exception 'rate_limited' using errcode = 'P0001', hint = 'Too many — wait a while.';
  end if;
end;
$$;
revoke all on function private.act_rate(uuid, text, integer, interval, boolean) from public, anon, authenticated;

-- ── who may see what (SECURITY DEFINER: they read profiles / memberships / notes on the caller's behalf) ──

-- May the signed-in person see `p_owner`'s notes ('note') or live song ('listening')? You can always see your own.
create or replace function private.act_can_see(p_owner uuid, p_kind text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.profiles p
    cross join lateral (select case p_kind when 'note' then p.notes_visibility when 'listening' then p.now_playing_visibility else 'off' end as v) s
    where p.id = p_owner
      and (p_owner = (select auth.uid()) or s.v = 'everyone' or (s.v = 'communities' and private.shares_community(p_owner)))
  )
$$;

-- Is there an unexpired note with this id? (Server clock. Says nothing about who may see it.)
create or replace function private.act_note_alive(p_owner uuid, p_key text) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.status_notes n where n.user_id = p_owner and n.id::text = p_key and n.expires_at > now()) $$;

-- An unexpired note the signed-in person may see.
create or replace function private.act_note_visible(p_owner uuid, p_key text) returns boolean
language sql stable security definer set search_path = ''
as $$ select private.act_note_alive(p_owner, p_key) and private.act_can_see(p_owner, 'note') $$;

-- A note, or a song that person is listening to right now (a fresh row, as Now playing counts it) and lets the caller see.
create or replace function private.act_subject_visible(p_owner uuid, p_kind text, p_key text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case p_kind
    when 'note' then private.act_note_visible(p_owner, p_key)
    when 'listening' then
      private.act_can_see(p_owner, 'listening')
      and (p_owner = (select auth.uid()) or exists (select 1 from public.now_playing np where np.user_id = p_owner and np.updated_at > now() - interval '2 minutes'))
    else false
  end
$$;

-- Hearts: only on someone else's thing that you can see.
create or replace function private.act_can_like(p_owner uuid, p_kind text, p_key text) returns boolean
language sql stable security definer set search_path = ''
as $$ select p_owner is distinct from (select auth.uid()) and private.act_subject_visible(p_owner, p_kind, p_key) $$;

-- Private replies: to someone else whose live note or song you can see, or who already wrote to you.
create or replace function private.act_can_message(p_to uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and p_to is distinct from (select auth.uid())
    and (
      exists (select 1 from public.status_notes n where n.user_id = p_to and n.expires_at > now() and private.act_can_see(p_to, 'note'))
      or (
        private.act_can_see(p_to, 'listening')
        and exists (select 1 from public.now_playing np where np.user_id = p_to and np.updated_at > now() - interval '2 minutes')
      )
      or exists (select 1 from public.activity_messages m where m.sender_id = p_to and m.recipient_id = (select auth.uid()))
    )
$$;

-- Has the signed-in person left notes on?
create or replace function private.act_notes_on() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.notes_visibility <> 'off') $$;

-- What a note looks like as a snapshot (the shape the app calls a MessageContext). Null when there is no such unexpired note.
create or replace function private.act_note_context(p_owner uuid, p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'kind', 'note',
    'text', nullif(n.body, ''),
    'track', case when n.track_title is null then null else jsonb_build_object(
      'title', n.track_title, 'artist', coalesce(n.track_artist, ''), 'album', coalesce(n.track_album, ''),
      'artworkUrl', n.track_artwork_url, 'trackUrl', n.track_url, 'source', n.track_source) end))
  from public.status_notes n
  where n.user_id = p_owner and n.id::text = p_key and n.expires_at > now()
$$;

-- The same for a song: what `p_owner` is listening to right now (a fresh Now playing row). Null when nothing is playing.
create or replace function private.act_song_context(p_owner uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'kind', 'listening',
    'track', jsonb_build_object('title', np.title, 'artist', np.artist, 'album', np.album, 'artworkUrl', np.artwork_url, 'trackUrl', np.track_url, 'source', np.source)))
  from public.now_playing np
  where np.user_id = p_owner and np.updated_at > now() - interval '2 minutes'
$$;

-- Counts and "did I like it" for ONE subject — and nothing at all (no row) unless the caller may see the subject. It never names
-- anyone who liked. This is the one place likes are counted for people who can't read the like rows.
create or replace function private.act_engagement(p_owner uuid, p_kind text, p_key text)
returns table (likes integer, comments integer, liked_by_me boolean)
language sql stable security definer set search_path = ''
as $$
  select
    (select count(*)::integer from public.activity_likes l where l.owner_id = p_owner and l.kind = p_kind and l.subject_key = p_key),
    (select count(*)::integer from public.activity_comments c where p_kind = 'note' and c.owner_id = p_owner and c.subject_key = p_key),
    exists (select 1 from public.activity_likes l where l.owner_id = p_owner and l.kind = p_kind and l.subject_key = p_key and l.actor_id = (select auth.uid()))
  where private.act_subject_visible(p_owner, p_kind, p_key)
$$;

revoke all on function
  private.act_can_see(uuid, text), private.act_note_alive(uuid, text), private.act_note_visible(uuid, text), private.act_subject_visible(uuid, text, text),
  private.act_can_like(uuid, text, text), private.act_can_message(uuid), private.act_notes_on(), private.act_note_context(uuid, text),
  private.act_song_context(uuid), private.act_engagement(uuid, text, text)
  from public, anon;
-- (act_note_context and act_song_context are only called by the triggers below, which run as their owner)
grant execute on function
  private.act_can_see(uuid, text), private.act_note_alive(uuid, text), private.act_note_visible(uuid, text), private.act_subject_visible(uuid, text, text),
  private.act_can_like(uuid, text, text), private.act_can_message(uuid), private.act_notes_on(), private.act_engagement(uuid, text, text)
  to authenticated;
revoke all on function private.act_note_context(uuid, text), private.act_song_context(uuid) from authenticated;

-- ── guards: server clock, rate limits, tidy-up ───────────────────────────────

create or replace function private.status_notes_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'immutable_column' using errcode = 'P0001';
    end if;
    -- posting again ends the old note: its comments and hearts go with it
    delete from public.activity_comments where owner_id = old.user_id and subject_key = old.id::text;
    delete from public.activity_likes where owner_id = old.user_id and kind = 'note' and subject_key = old.id::text;
  end if;

  -- the server's clock and a new id for every posting, always: a client can't pick when a note expires or which note it is
  new.id := gen_random_uuid();
  new.created_at := now();
  new.expires_at := now() + interval '24 hours';

  new.body := btrim(new.body);
  new.track_title := nullif(btrim(new.track_title), '');
  new.track_artist := btrim(new.track_artist);
  new.track_album := btrim(new.track_album);
  if new.track_title is null then
    new.track_artist := nullif(new.track_artist, '');
    new.track_album := nullif(new.track_album, '');
  else
    new.track_artist := coalesce(new.track_artist, '');
    new.track_album := coalesce(new.track_album, '');
  end if;
  new.track_artwork_url := nullif(btrim(new.track_artwork_url), '');
  new.track_url := nullif(btrim(new.track_url), '');

  -- at most 10 postings an hour
  perform private.act_rate(new.user_id, 'note', 10, interval '1 hour', tg_op = 'UPDATE');

  -- every new posting (an upsert counts as one) first sweeps away notes that have expired — and, through the delete trigger, their comments and hearts
  if tg_op = 'INSERT' then
    delete from public.status_notes where expires_at <= now();
  end if;
  return new;
end;
$$;
revoke all on function private.status_notes_guard() from public, anon, authenticated;
drop trigger if exists status_notes_guard_trg on public.status_notes;
create trigger status_notes_guard_trg before insert or update on public.status_notes for each row execute function private.status_notes_guard();

-- A note that is deleted (by its owner, by expiry, by turning notes off, with the account) takes its comments and hearts with it.
create or replace function private.status_notes_deleted() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.activity_comments where owner_id = old.user_id and subject_key = old.id::text;
  delete from public.activity_likes where owner_id = old.user_id and kind = 'note' and subject_key = old.id::text;
  return old;
end;
$$;
revoke all on function private.status_notes_deleted() from public, anon, authenticated;
drop trigger if exists status_notes_deleted_trg on public.status_notes;
create trigger status_notes_deleted_trg after delete on public.status_notes for each row execute function private.status_notes_deleted();

-- Turning notes off deletes the note — here, in the database, not left to the client to remember.
create or replace function private.notes_visibility_changed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.notes_visibility = 'off' then
    delete from public.status_notes where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.notes_visibility_changed() from public, anon, authenticated;
drop trigger if exists profiles_notes_off_trg on public.profiles;
create trigger profiles_notes_off_trg
  after update of notes_visibility on public.profiles
  for each row when (old.notes_visibility is distinct from new.notes_visibility)
  execute function private.notes_visibility_changed();

-- Hearts: the server's clock, at most 60 an hour, and the snapshot is built by the database from the thing that is hearted — the
-- note itself, or the song the owner is playing right now — so what the owner is told can't differ from what was hearted, whatever
-- the client sent. (A snapshot that isn't even well formed, or names the wrong kind, is refused rather than quietly replaced.)
create or replace function private.activity_likes_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  snap jsonb;
begin
  new.created_at := now();
  if new.actor_id is null or new.owner_id is null then
    return new; -- NOT NULL refuses it
  end if;
  if not private.act_context_ok(new.context) or (new.context ->> 'kind') is distinct from new.kind then
    raise exception 'invalid_context' using errcode = '23514';
  end if;
  perform private.act_rate(new.actor_id, 'like', 60, interval '1 hour');
  if new.kind = 'note' then
    snap := private.act_note_context(new.owner_id, new.subject_key);
  elsif new.kind = 'listening' then
    snap := private.act_song_context(new.owner_id);
  end if;
  if snap is not null then new.context := snap; end if;
  return new;
end;
$$;
revoke all on function private.activity_likes_guard() from public, anon, authenticated;
drop trigger if exists activity_likes_guard_trg on public.activity_likes;
create trigger activity_likes_guard_trg before insert on public.activity_likes for each row execute function private.activity_likes_guard();

-- A new heart notifies its owner — once per (person, owner, kind, subject), however often it is taken back and given again.
create or replace function private.activity_likes_notify() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.activity_messages (sender_id, recipient_id, kind, body, context, subject_kind, subject_key)
  values (new.actor_id, new.owner_id, 'like', '', new.context, new.kind, new.subject_key)
  on conflict (sender_id, recipient_id, subject_kind, subject_key) where kind = 'like' do nothing;
  return null;
end;
$$;
revoke all on function private.activity_likes_notify() from public, anon, authenticated;
drop trigger if exists activity_likes_notify_trg on public.activity_likes;
create trigger activity_likes_notify_trg after insert on public.activity_likes for each row execute function private.activity_likes_notify();

create or replace function private.activity_comments_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.created_at := now();
  new.body := btrim(new.body);
  if new.author_id is not null then
    perform private.act_rate(new.author_id, 'comment', 30, interval '1 hour');
  end if;
  return new;
end;
$$;
revoke all on function private.activity_comments_guard() from public, anon, authenticated;
drop trigger if exists activity_comments_guard_trg on public.activity_comments;
create trigger activity_comments_guard_trg before insert on public.activity_comments for each row execute function private.activity_comments_guard();

-- A comment notifies the note's owner (not when they comment on their own note), with a snapshot of the note taken now.
create or replace function private.activity_comments_notify() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.author_id <> new.owner_id then
    insert into public.activity_messages (sender_id, recipient_id, kind, body, context, subject_kind, subject_key)
    values (new.author_id, new.owner_id, 'comment', new.body, private.act_note_context(new.owner_id, new.subject_key), 'note', new.subject_key);
  end if;
  return null;
end;
$$;
revoke all on function private.activity_comments_notify() from public, anon, authenticated;
drop trigger if exists activity_comments_notify_trg on public.activity_comments;
create trigger activity_comments_notify_trg after insert on public.activity_comments for each row execute function private.activity_comments_notify();

create or replace function private.activity_messages_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.read_at := null;
    new.body := btrim(new.body);
    -- likes and comments are rate-limited where they are made; a person's own replies are limited here (30 an hour)
    if new.kind = 'reply' and new.sender_id is not null then
      perform private.act_rate(new.sender_id, 'reply', 30, interval '1 hour');
    end if;
    return new;
  end if;

  -- UPDATE: the only thing that ever changes is when the recipient read it — stamped by the server, set once, never taken back
  if (new.id, new.sender_id, new.recipient_id, new.kind, new.body, new.context, new.subject_kind, new.subject_key, new.created_at)
     is distinct from (old.id, old.sender_id, old.recipient_id, old.kind, old.body, old.context, old.subject_kind, old.subject_key, old.created_at) then
    raise exception 'immutable_column' using errcode = 'P0001';
  end if;
  new.read_at := case when old.read_at is not null then old.read_at when new.read_at is not null then now() else null end;
  return new;
end;
$$;
revoke all on function private.activity_messages_guard() from public, anon, authenticated;
drop trigger if exists activity_messages_guard_trg on public.activity_messages;
create trigger activity_messages_guard_trg before insert or update on public.activity_messages for each row execute function private.activity_messages_guard();

-- ── policies ─────────────────────────────────────────────────────────────────

-- Notes: an unexpired note of someone who lets you see it (and your own). Writing needs notes to be on, and only ever your own row.
drop policy if exists "status_notes: read visible" on public.status_notes;
create policy "status_notes: read visible" on public.status_notes for select to authenticated
  using (expires_at > now() and private.act_can_see(user_id, 'note'));
drop policy if exists "status_notes: write own" on public.status_notes;
create policy "status_notes: write own" on public.status_notes for insert to authenticated
  with check ((select auth.uid()) = user_id and private.act_notes_on());
drop policy if exists "status_notes: update own" on public.status_notes;
create policy "status_notes: update own" on public.status_notes for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id and private.act_notes_on());
drop policy if exists "status_notes: delete own" on public.status_notes;
create policy "status_notes: delete own" on public.status_notes for delete to authenticated using ((select auth.uid()) = user_id);

-- Likes: you can read yours, and the owner can read the likes on their things (to know who). Nobody else can read who liked.
drop policy if exists "activity_likes: read mine and on mine" on public.activity_likes;
create policy "activity_likes: read mine and on mine" on public.activity_likes for select to authenticated
  using ((select auth.uid()) = actor_id or (select auth.uid()) = owner_id);
drop policy if exists "activity_likes: like" on public.activity_likes;
create policy "activity_likes: like" on public.activity_likes for insert to authenticated
  with check ((select auth.uid()) = actor_id and private.act_can_like(owner_id, kind, subject_key));
drop policy if exists "activity_likes: take back" on public.activity_likes;
create policy "activity_likes: take back" on public.activity_likes for delete to authenticated using ((select auth.uid()) = actor_id);

-- Comments: public to whoever can see the (unexpired) note, plus its author and owner while it lasts.
drop policy if exists "activity_comments: read" on public.activity_comments;
create policy "activity_comments: read" on public.activity_comments for select to authenticated
  using (
    private.act_note_alive(owner_id, subject_key)
    and ((select auth.uid()) = author_id or (select auth.uid()) = owner_id or private.act_can_see(owner_id, 'note'))
  );
drop policy if exists "activity_comments: comment" on public.activity_comments;
create policy "activity_comments: comment" on public.activity_comments for insert to authenticated
  with check ((select auth.uid()) = author_id and private.act_note_visible(owner_id, subject_key));
drop policy if exists "activity_comments: delete mine or on my note" on public.activity_comments;
create policy "activity_comments: delete mine or on my note" on public.activity_comments for delete to authenticated
  using ((select auth.uid()) = author_id or (select auth.uid()) = owner_id);

-- Messages: the sender and the recipient read them. A client writes only replies (likes and comments come from the triggers);
-- only the recipient marks them read or deletes them.
drop policy if exists "activity_messages: read mine" on public.activity_messages;
create policy "activity_messages: read mine" on public.activity_messages for select to authenticated
  using ((select auth.uid()) = sender_id or (select auth.uid()) = recipient_id);
drop policy if exists "activity_messages: reply" on public.activity_messages;
create policy "activity_messages: reply" on public.activity_messages for insert to authenticated
  with check ((select auth.uid()) = sender_id and kind = 'reply' and recipient_id <> (select auth.uid()) and private.act_can_message(recipient_id));
drop policy if exists "activity_messages: mark read" on public.activity_messages;
create policy "activity_messages: mark read" on public.activity_messages for update to authenticated
  using ((select auth.uid()) = recipient_id) with check ((select auth.uid()) = recipient_id);
drop policy if exists "activity_messages: delete received" on public.activity_messages;
create policy "activity_messages: delete received" on public.activity_messages for delete to authenticated using ((select auth.uid()) = recipient_id);

-- ── privileges ───────────────────────────────────────────────────────────────
-- The columns a client may NAME: never an id, a sender / author / actor, a timestamp, an expiry, or the kind of a message
-- (it defaults to 'reply'; likes and comments are written by the triggers). Everything else is the server's.

revoke all on table public.status_notes, public.activity_likes, public.activity_comments, public.activity_messages from anon, authenticated;

grant select, delete on table public.status_notes to authenticated;
grant insert (user_id, body, track_title, track_artist, track_album, track_artwork_url, track_url, track_source) on table public.status_notes to authenticated;
grant update (user_id, body, track_title, track_artist, track_album, track_artwork_url, track_url, track_source) on table public.status_notes to authenticated;

grant select, delete on table public.activity_likes to authenticated;
grant insert (owner_id, kind, subject_key, context) on table public.activity_likes to authenticated;

grant select, delete on table public.activity_comments to authenticated;
grant insert (owner_id, subject_key, body) on table public.activity_comments to authenticated;

grant select, delete on table public.activity_messages to authenticated;
grant insert (recipient_id, body, context) on table public.activity_messages to authenticated;
grant update (read_at) on table public.activity_messages to authenticated;

-- ── reading ──────────────────────────────────────────────────────────────────

-- The feed: unexpired notes of the people the caller may see (and their own), newest first, with counts. SECURITY INVOKER: the
-- `status_notes` policy decides which notes come back; the counts come from `private.act_engagement`, which applies the same rule.
-- At most 50 a page; `p_before` is the `created_at` of the last note the caller already has.
create or replace function public.activity_feed(p_limit integer default 30, p_before timestamptz default null)
returns table (
  user_id uuid, id uuid, body text,
  track_title text, track_artist text, track_album text, track_artwork_url text, track_url text, track_source text,
  created_at timestamptz, expires_at timestamptz,
  likes integer, comments integer, liked_by_me boolean
)
language sql stable security invoker set search_path = ''
as $$
  select n.user_id, n.id, n.body,
         n.track_title, n.track_artist, n.track_album, n.track_artwork_url, n.track_url, n.track_source,
         n.created_at, n.expires_at,
         coalesce(e.likes, 0), coalesce(e.comments, 0), coalesce(e.liked_by_me, false)
  from public.status_notes n
  left join lateral private.act_engagement(n.user_id, 'note', n.id::text) e on true
  where n.expires_at > now() and (p_before is null or n.created_at < p_before)
  order by n.created_at desc, n.id desc
  limit least(greatest(coalesce(p_limit, 30), 1), 50)
$$;

-- Likes / comments counts and "did I like it" for up to 100 subjects: [{ "owner_id": …, "kind": "note" | "listening", "subject_key": … }].
-- Subjects the caller may not see are simply absent from the answer, as are malformed entries. Nobody is ever named.
create or replace function public.activity_engagement(p_refs jsonb)
returns table (owner_id uuid, kind text, subject_key text, likes integer, comments integer, liked_by_me boolean)
language sql stable security invoker set search_path = ''
as $$
  select r.owner_id, r.kind, r.subject_key, e.likes, e.comments, e.liked_by_me
  from (
    select
      case when x ->> 'owner_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (x ->> 'owner_id')::uuid end as owner_id,
      x ->> 'kind' as kind,
      x ->> 'subject_key' as subject_key
    from jsonb_array_elements(case when jsonb_typeof(p_refs) = 'array' then p_refs else '[]'::jsonb end) with ordinality as t (x, i)
    where i <= 100 and jsonb_typeof(x) = 'object'
  ) r
  cross join lateral private.act_engagement(r.owner_id, r.kind, r.subject_key) e
  where r.owner_id is not null and r.kind is not null and r.subject_key is not null
$$;

revoke all on function public.activity_feed(integer, timestamptz), public.activity_engagement(jsonb) from public, anon;
grant execute on function public.activity_feed(integer, timestamptz), public.activity_engagement(jsonb) to authenticated;

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- postgres_changes respects the SELECT policies above: a viewer is only sent rows they could select (a like row: only its giver and
-- its owner; a message: only its sender and recipient; a note: only people who may see it). DELETE events carry just the primary key.
-- Comments are not published: the owner learns of one from the activity message, and everyone else refetches when they look.

do $$
declare
  t text;
begin
  foreach t in array array['status_notes', 'activity_messages', 'activity_likes'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
