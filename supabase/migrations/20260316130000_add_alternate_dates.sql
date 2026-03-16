-- Create event_dates table
create table if not exists public.event_dates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  starts_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Migrating existing event dates from the main events table
insert into public.event_dates (event_id, starts_at)
select id, starts_at from public.events;

-- Update event_responses to link to event_dates
alter table public.event_responses add column event_date_id uuid references public.event_dates(id) on delete cascade;

-- Fill event_date_id based on the migration above
update public.event_responses er
set event_date_id = ed.id
from public.event_dates ed
where er.event_id = ed.event_id;

-- Make event_date_id not null after migration
alter table public.event_responses alter column event_date_id set not null;

-- Update unique constraint for event_responses
alter table public.event_responses drop constraint if exists event_responses_event_id_user_id_key;
alter table public.event_responses add constraint event_responses_event_date_id_user_id_key unique(event_date_id, user_id);

-- Clean up unused column in events (optional, but starts_at is now handled in event_dates)
-- Keeping it for now to avoid breaking existing queries if they haven't been updated yet, 
-- but we should stop using it.
-- alter table public.events drop column starts_at;

-- Update RLS policies for event_dates
alter table public.event_dates enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'event_dates' and policyname = 'Founders can manage event dates') then
    create policy "Founders can manage event dates" on public.event_dates
      for all
      using (
        exists (
          select 1 from public.app_users
          where id = auth.uid() and role = 'founder'
        )
      );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'event_dates' and policyname = 'Executives can view valid event dates') then
    create policy "Executives can view valid event dates" on public.event_dates
      for select
      using (
        exists (
          select 1 from public.events e
          where e.id = event_id
          and exists (
            select 1 from public.app_users u
            where u.id = auth.uid()
            and (u.role = 'founder' or u.role = 'executive' or u.role = 'tutor')
            and (
              u.role = 'founder'
              or (not e.is_junior_excluded)
              or (not u.is_junior)
            )
          )
        )
      );
  end if;
end $$;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
