-- Track temporary Discord live voice channels per class.
create table if not exists public.discord_live_class_channels (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null unique references public.course_classes(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  discord_channel_id text not null unique,
  tutor_discord_user_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.discord_live_class_channels enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where tablename = 'discord_live_class_channels'
      and policyname = 'read live class channels'
  ) then
    create policy "read live class channels"
      on public.discord_live_class_channels
      for select
      using (auth.role() = 'authenticated');
  end if;
end $$;
