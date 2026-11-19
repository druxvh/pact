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
