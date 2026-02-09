create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  full_name text,
  role text not null default 'student',
  tutor_promoted_at timestamptz,
  password_hash text not null,
  email_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.app_email_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  short_name text,
  description text,
  is_completed boolean not null default false,
  completed_start_date date,
  completed_end_date date,
  completed_class_count integer,
  created_by uuid references public.app_users(id) on delete set null,
  created_by_name text,
  created_by_email text,
  created_at timestamptz not null default now()
);

alter table public.courses enable row level security;

create policy "read courses" on public.courses
  for select
  using (auth.role() = 'authenticated');

create policy "insert courses as self" on public.courses
  for insert
  with check (auth.uid() = created_by);

create table if not exists public.course_classes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  duration_hours numeric(4,2) not null default 1,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.course_classes enable row level security;

create policy "read course classes" on public.course_classes
  for select
  using (auth.role() = 'authenticated');

create policy "insert course classes as self" on public.course_classes
  for insert
  with check (auth.uid() = created_by);

create table if not exists public.course_enrollment_requests (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.app_users(id) on delete cascade,
  student_name text,
  student_email text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

alter table public.course_enrollment_requests enable row level security;

create policy "students can view their enrollment requests" on public.course_enrollment_requests
  for select
  using (auth.uid() = student_id);

create policy "students can create enrollment requests" on public.course_enrollment_requests
  for insert
  with check (auth.uid() = student_id);

create table if not exists public.course_enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.app_users(id) on delete cascade,
  student_name text,
  student_email text,
  created_at timestamptz not null default now(),
  unique(course_id, student_id)
);

alter table public.course_enrollments enable row level security;

create policy "students can view their enrollments" on public.course_enrollments
  for select
  using (auth.uid() = student_id);

create table if not exists public.tutor_profiles (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  donation_link text,
  updated_at timestamptz not null default now()
);

alter table public.tutor_profiles enable row level security;

create policy "tutors can view their profile" on public.tutor_profiles
  for select
  using (auth.uid() = user_id);

create table if not exists public.class_reminder_logs (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.course_classes(id) on delete cascade,
  reminder_type text not null,
  created_at timestamptz not null default now(),
  unique(class_id, reminder_type)
);

create table if not exists public.site_settings (
  id boolean primary key default true,
  maintenance_mode boolean not null default false,
  updated_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (id = true)
);

insert into public.site_settings (id, maintenance_mode)
values (true, false)
on conflict (id) do nothing;
