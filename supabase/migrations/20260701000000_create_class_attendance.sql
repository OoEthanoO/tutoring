-- Records which enrolled students (and the tutor) actually joined a class's
-- Discord voice channel. A row's presence means the user was detected in the
-- class voice channel at least once; absence is derived on read (enrolled
-- students for the class minus those with a row).
create table if not exists public.class_attendance (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.course_classes(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  discord_user_id text not null,
  is_tutor boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (class_id, user_id)
);

create index if not exists class_attendance_class_id_idx on public.class_attendance (class_id);
create index if not exists class_attendance_user_id_idx on public.class_attendance (user_id);

alter table public.class_attendance enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where tablename = 'class_attendance'
      and policyname = 'read class attendance'
  ) then
    create policy "read class attendance"
      on public.class_attendance
      for select
      using (auth.role() = 'authenticated');
  end if;
end $$;
