-- Migration to add Zoom meeting support for course classes

-- Add zoom_meeting_id column to course_classes table
alter table public.course_classes
add column zoom_meeting_id text,
add column zoom_start_url text,
add column zoom_join_url text,
add column zoom_created_at timestamptz;

-- Create a table to track Zoom meeting sessions
create table if not exists public.zoom_meeting_sessions (
  id uuid primary key default gen_random_uuid(),
  course_class_id uuid not null references public.course_classes(id) on delete cascade,
  zoom_meeting_id text not null,
  host_user_id uuid not null references public.app_users(id) on delete restrict,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.zoom_meeting_sessions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'zoom_meeting_sessions' and policyname = 'read zoom sessions') then
    create policy "read zoom sessions" on public.zoom_meeting_sessions for select using (auth.role() = 'authenticated');
  end if;
end $$;

-- Create a table to track participant join links (for per-user unique links)
create table if not exists public.zoom_participant_links (
  id uuid primary key default gen_random_uuid(),
  zoom_meeting_id text not null,
  student_id uuid not null references public.app_users(id) on delete cascade,
  join_url text not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  unique(zoom_meeting_id, student_id)
);

alter table public.zoom_participant_links enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'zoom_participant_links' and policyname = 'read own links') then
    create policy "read own links" on public.zoom_participant_links for select using (auth.uid() = student_id);
  end if;
end $$;
