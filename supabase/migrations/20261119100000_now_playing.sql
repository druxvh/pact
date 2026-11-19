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
