create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  created_by uuid references auth.users(id) on delete set null,
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
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.course_classes enable row level security;

create policy "read course classes" on public.course_classes
  for select
  using (auth.role() = 'authenticated');

create policy "insert course classes as self" on public.course_classes
  for insert
  with check (auth.uid() = created_by);
