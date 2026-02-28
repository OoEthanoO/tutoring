alter table if exists public.app_users
  add column if not exists discord_user_id text;

alter table if exists public.app_users
  add column if not exists discord_username text;

alter table if exists public.app_users
  add column if not exists discord_connected_at timestamptz;

create unique index if not exists app_users_discord_user_id_unique
  on public.app_users(discord_user_id)
  where discord_user_id is not null;
