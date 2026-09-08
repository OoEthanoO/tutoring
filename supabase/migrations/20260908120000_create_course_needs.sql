-- Course needs: the running list of courses nobody teaches yet.
--
-- The founder trio adds to it (Admin -> Manage accounts -> Admin Tools) and
-- removes from it once someone takes the course on; every executive sees it in
-- Course requests. Adding a course is what makes YanBot announce it in Discord,
-- so `need_key` is unique: re-typing a course already on the list is a no-op
-- rather than a second ping.

create table if not exists public.course_needs (
  id uuid primary key default gen_random_uuid(),
  need text not null,
  -- The same course name, lowercased and single-spaced, so "Grade 6 French"
  -- and "grade 6  french" are one entry.
  need_key text not null unique,
  created_by uuid references public.app_users(id) on delete set null,
  created_by_email text,
  created_at timestamptz not null default now(),
  -- Null when the Discord announcement did not go out; the panel offers a retry.
  announced_at timestamptz
);

create index if not exists course_needs_created_at_idx on public.course_needs (created_at desc);

alter table public.course_needs enable row level security;

create policy "Deny all access" on public.course_needs for all using (false);

notify pgrst, 'reload schema';
