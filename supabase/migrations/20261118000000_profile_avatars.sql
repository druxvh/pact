-- Profile pictures, and a way to ask "is this username free?" before saving.
--
-- The database stores an object *path* (`<user id>/<random>.webp`), never a URL: a free-form URL would let anyone point
-- their avatar at a server they control and watch which community-mates load it. The client builds the public URL itself.

alter table public.profiles add column avatar_path text;
alter table public.profiles add constraint profiles_avatar_path_format check (
  avatar_path is null or avatar_path ~ ('^' || id::text || '/[a-z0-9_-]{8,40}\.webp$')
);

-- ── Storage: a small public bucket, one folder per person ────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp'])
on conflict (id) do nothing;

create function private.avatar_files(uid uuid) returns integer
language sql stable security definer set search_path = ''
as $$ select count(*)::int from storage.objects o where o.bucket_id = 'avatars' and o.name like uid::text || '/%' $$;

revoke all on function private.avatar_files(uuid) from public, anon;
grant execute on function private.avatar_files(uuid) to authenticated;

-- Reading goes through the public URL (the bucket is public); these policies only govern writing and the owner's own listing.
-- Files are never updated in place (each upload has a fresh random name, so caches never serve a stale picture), and a
-- person can keep at most a handful at once — the client deletes the old one after a successful swap.
create policy "avatars: read own folder" on storage.objects for select to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy "avatars: upload into own folder" on storage.objects for insert to authenticated with check (
  bucket_id = 'avatars'
  and array_length(storage.foldername(name), 1) = 1
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ ('^' || (select auth.uid())::text || '/[a-z0-9_-]{8,40}\.webp$')
  and private.avatar_files((select auth.uid())) < 6
);
create policy "avatars: remove own" on storage.objects for delete to authenticated using (
  bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- ── Usernames: unique, and checkable while typing ────────────────────────────
-- Uniqueness itself is `profiles_username_key` (plus the lowercase-only format check, so "Sam" and "sam" can't both exist).
-- This answers "can I have it?" without opening the profiles table: true when the name is valid and nobody else has it.

create function public.username_available(name text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select name ~ '^[a-z0-9_]{3,20}$'
    and not exists (select 1 from public.profiles p where p.username = name and p.id is distinct from (select auth.uid()))
$$;

revoke all on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;
