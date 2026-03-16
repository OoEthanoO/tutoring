-- Create events table
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  starts_at timestamptz not null,
  location text,
  is_junior_excluded boolean not null default false,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Create event_responses table
create table if not exists public.event_responses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  attendance text not null check (attendance in ('yes', 'no')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, user_id)
);

-- Enable RLS
alter table public.events enable row level security;
alter table public.event_responses enable row level security;

-- Policies for events
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'events' and policyname = 'Founders can do everything on events') then
    create policy "Founders can do everything on events" on public.events
      for all
      using (
        exists (
          select 1 from public.app_users
          where id = auth.uid() and role = 'founder'
        )
      );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'events' and policyname = 'Executives can view valid events') then
    create policy "Executives can view valid events" on public.events
      for select
      using (
        exists (
          select 1 from public.app_users
          where id = auth.uid() 
          and (role = 'founder' or role = 'executive' or role = 'tutor')
          and (
            role = 'founder' 
            or (not is_junior_excluded)
            or (not is_junior)
          )
        )
      );
  end if;
end $$;

-- Policies for event_responses
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'event_responses' and policyname = 'Founders can view all responses') then
    create policy "Founders can view all responses" on public.event_responses
      for select
      using (
        exists (
          select 1 from public.app_users
          where id = auth.uid() and role = 'founder'
        )
      );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'event_responses' and policyname = 'Users can manage their own responses') then
    create policy "Users can manage their own responses" on public.event_responses
      for all
      using (auth.uid() = user_id);
  end if;
end $$;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
