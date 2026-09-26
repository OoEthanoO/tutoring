alter table public.courses add column zen_mode_enabled boolean not null default false;

-- Remember only server mutes applied by Zen, so moderation mutes are preserved.
create table public.discord_zen_mutes (
  discord_user_id text primary key,
  created_at timestamptz not null default now()
);
-- Only the voice-related permission bits are saved/restored, never old access.
create table public.discord_zen_channels (
  discord_channel_id text primary key,
  original_permissions jsonb not null,
  created_at timestamptz not null default now()
);
create table public.discord_zen_sync_lock (
  id boolean primary key default true check(id),
  token uuid,
  expires_at timestamptz not null default now()
);
insert into public.discord_zen_sync_lock(id) values(true);
alter table public.discord_zen_mutes enable row level security;
alter table public.discord_zen_channels enable row level security;
alter table public.discord_zen_sync_lock enable row level security;
create policy "Deny all access" on public.discord_zen_mutes for all using(false);
create policy "Deny all access" on public.discord_zen_channels for all using(false);
create policy "Deny all access" on public.discord_zen_sync_lock for all using(false);

-- REST calls cannot share a PostgreSQL transaction. A bounded lease serializes
-- toggles and cron reconciliation; callers stop starting calls after 45 seconds.
create function public.claim_zen_mode_sync(p_token uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.discord_zen_sync_lock set token=p_token, expires_at=clock_timestamp() + interval '90 seconds'
    where id and expires_at <= clock_timestamp();
  return found;
end;
$$;
create function public.release_zen_mode_sync(p_token uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.discord_zen_sync_lock set token=null, expires_at=clock_timestamp() where id and token=p_token;
$$;
revoke all on function public.claim_zen_mode_sync(uuid), public.release_zen_mode_sync(uuid) from public, anon, authenticated;
grant execute on function public.claim_zen_mode_sync(uuid), public.release_zen_mode_sync(uuid) to service_role;
