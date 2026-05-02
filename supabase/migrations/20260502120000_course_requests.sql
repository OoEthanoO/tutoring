create table if not exists public.course_creation_requests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  timeframes jsonb not null default '{}'::jsonb,
  frequency text,
  notes text,
  status text not null default 'pending',
  created_by uuid references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.app_users(id) on delete set null
);

alter table public.course_creation_requests enable row level security;

create policy "founders can read all course requests" on public.course_creation_requests
  for select
  using (
    exists (
      select 1 from public.app_users
      where app_users.id = auth.uid()
      and app_users.role = 'founder'
    )
  );

create policy "users can read their own course requests" on public.course_creation_requests
  for select
  using (auth.uid() = created_by);

create policy "users can create course requests" on public.course_creation_requests
  for insert
  with check (auth.uid() = created_by);

create policy "founders can update course requests" on public.course_creation_requests
  for update
  using (
    exists (
      select 1 from public.app_users
      where app_users.id = auth.uid()
      and app_users.role = 'founder'
    )
  );
