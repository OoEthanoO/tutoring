-- Junior Executive is retired (September 2026). An executive who has not
-- uploaded a single course they teach now holds the "Pending" Discord role
-- instead of Executive, and the two are exclusive — the standing is computed
-- per sync from the courses table (src/lib/executiveStanding.ts), not stored.
--
-- The founder trio can exempt someone who is on the team without a course of
-- their own (a designer, say); an exempt person stays a plain Executive.

alter table public.app_users
  add column if not exists pending_role_exempt boolean not null default false;

comment on column public.app_users.pending_role_exempt is
  'Founder-set: keep the Executive Discord role without teaching a course.';

-- Anyone still stored as a Junior Executive is a plain executive; whether they
-- show up as Executive or Pending in Discord is decided by their courses.
update public.app_users
  set role = 'Executive'
  where lower(trim(role)) in ('junior executive', 'junior exec');

alter table public.custom_roles
  drop constraint if exists custom_roles_role_level_check;

update public.custom_roles
  set role_level = 'Executive'
  where lower(trim(role_level)) in ('junior executive', 'junior exec');

alter table public.custom_roles
  add constraint custom_roles_role_level_check
  check (role_level in ('CEO', 'COO', 'Chief Executive', 'Executive', 'Student'));

notify pgrst, 'reload schema';
