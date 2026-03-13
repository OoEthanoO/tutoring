-- Migration to restore missing tables from courses.sql that are missing in the current schema cache.

-- 1. Create course_classes table
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

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'course_classes' and policyname = 'read course classes') then
    create policy "read course classes" on public.course_classes for select using (auth.role() = 'authenticated');
  end if;
  if not exists (select 1 from pg_policies where tablename = 'course_classes' and policyname = 'insert course classes as self') then
    create policy "insert course classes as self" on public.course_classes for insert with check (auth.uid() = created_by);
  end if;
end $$;

-- 2. Create course_enrollments table
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

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'course_enrollments' and policyname = 'students can view their enrollments') then
    create policy "students can view their enrollments" on public.course_enrollments for select using (auth.uid() = student_id);
  end if;
end $$;

-- 3. Create course_enrollment_requests table
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

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'course_enrollment_requests' and policyname = 'students can view their enrollment requests') then
    create policy "students can view their enrollment requests" on public.course_enrollment_requests for select using (auth.uid() = student_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'course_enrollment_requests' and policyname = 'students can create enrollment requests') then
    create policy "students can create enrollment requests" on public.course_enrollment_requests for insert with check (auth.uid() = student_id);
  end if;
end $$;

-- 4. Create tutor_profiles table
create table if not exists public.tutor_profiles (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  donation_link text,
  updated_at timestamptz not null default now()
);

alter table public.tutor_profiles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'tutor_profiles' and policyname = 'tutors can view their profile') then
    create policy "tutors can view their profile" on public.tutor_profiles for select using (auth.uid() = user_id);
  end if;
end $$;

-- 5. Create class_reminder_logs table
create table if not exists public.class_reminder_logs (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.course_classes(id) on delete cascade,
  reminder_type text not null,
  created_at timestamptz not null default now(),
  unique(class_id, reminder_type)
);

alter table public.class_reminder_logs enable row level security;

-- 6. Create feedback_submissions table
create table if not exists public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.app_users(id) on delete set null,
  user_email text,
  user_name text,
  contact_email text,
  message text not null,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

alter table public.feedback_submissions enable row level security;

-- 7. Create student_applications table
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

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'student_applications' and policyname = 'Admins can view all student applications') then
    create policy "Admins can view all student applications" on public.student_applications
      for select
      using (
        exists (
          select 1 from public.app_users
          where id = auth.uid() and (role = 'founder' or role = 'executive' or role = 'tutor')
        )
      );
  end if;
  if not exists (select 1 from pg_policies where tablename = 'student_applications' and policyname = 'Users can view their own student applications') then
    create policy "Users can view their own student applications" on public.student_applications
      for select
      using (auth.uid() = student_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'student_applications' and policyname = 'Users can insert their own student applications') then
    create policy "Users can insert their own student applications" on public.student_applications
      for insert
      with check (auth.uid() = student_id);
  end if;
end $$;

-- Notify PostgREST to reload schema
notify pgrst, 'reload schema';
