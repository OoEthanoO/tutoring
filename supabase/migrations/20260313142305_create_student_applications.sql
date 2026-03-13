create table if not exists public.student_applications (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.app_users(id) on delete cascade,
  guardian_email text not null,
  student_full_name text not null,
  school_name text not null,
  grade text not null,
  parent_guardian_name text not null,
  parent_guardian_phone text not null,
  consent_name text not null,
  created_at timestamptz not null default now()
);

alter table public.student_applications enable row level security;

create policy "Admins can view all student applications" on public.student_applications
  for select
  using (
    exists (
      select 1 from public.app_users
      where id = auth.uid() and (role = 'founder' or role = 'executive' or role = 'tutor')
    )
  );

create policy "Users can view their own student applications" on public.student_applications
  for select
  using (auth.uid() = student_id);

create policy "Users can insert their own student applications" on public.student_applications
  for insert
  with check (auth.uid() = student_id);
