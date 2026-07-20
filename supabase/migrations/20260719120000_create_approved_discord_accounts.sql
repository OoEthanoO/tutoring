-- Discord accounts allowed to stay in the guild without a linked website user,
-- e.g. a tutor's second account used in lesson calls. When owner_user_id is set,
-- the account also mirrors that user's course roles and live-channel access.
create table if not exists public.approved_discord_accounts (
  discord_user_id text primary key,
  owner_user_id uuid references public.app_users(id) on delete cascade,
  label text,
  created_at timestamptz not null default now()
);

alter table public.approved_discord_accounts enable row level security;

create policy "Deny all access" on public.approved_discord_accounts for all using (false);
