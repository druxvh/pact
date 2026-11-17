-- Community members need to read each other's *public* profile (name, @username, role, bio) — but never an email.
-- Row-level security can't hide a column, so private fields move to their own owner-only table.

create table public.profile_private (
  id uuid primary key references auth.users (id) on delete cascade,
  contact_email text,
  constraint profile_private_email_length check (char_length(coalesce(contact_email, '')) <= 120)
);

alter table public.profile_private enable row level security;
create policy "profile_private: read own" on public.profile_private for select to authenticated using ((select auth.uid()) = id);
create policy "profile_private: insert own" on public.profile_private for insert to authenticated with check ((select auth.uid()) = id);
create policy "profile_private: update own" on public.profile_private for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
revoke all on table public.profile_private from anon, authenticated;
grant select, insert, update on table public.profile_private to authenticated;

insert into public.profile_private (id, contact_email) select id, contact_email from public.profiles where contact_email is not null;

alter table public.profiles drop constraint profiles_text_lengths;
alter table public.profiles drop column contact_email;
alter table public.profiles add constraint profiles_text_lengths check (
  char_length(display_name) <= 40 and char_length(designation) <= 60 and char_length(bio) <= 160
);

-- A new account's suggested @username used to fall back to the local part of the email address ("jane.doe1984@…" →
-- "janedoe1984"), which community-mates can now see. Use the provider's public handle if there is one, otherwise a random one.
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
  return new;
end;
$$;
