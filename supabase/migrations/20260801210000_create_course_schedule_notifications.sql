-- Tracks what each course's schedule looked like the last time enrolled
-- students were told about it, so student-facing notifications can be a
-- coalesced digest of the NET change rather than one message per edit.
--
--  observed_schedule  the schedule seen on the previous cron tick
--  observed_at        when observed_schedule last differed from the tick before
--                     (every edit pushes this forward, so the digest waits until
--                      the person rescheduling has finished)
--  notified_schedule  the schedule students were last told about; the digest is
--                     the diff between this and the current schedule, so edits
--                     that cancel out produce no message at all
create table if not exists public.course_schedule_notifications (
  course_id uuid primary key references public.courses(id) on delete cascade,
  observed_schedule jsonb,
  observed_at timestamptz,
  notified_schedule jsonb,
  notified_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.course_schedule_notifications enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'course_schedule_notifications'
      and policyname = 'deny all course schedule notifications'
  ) then
    create policy "deny all course schedule notifications"
      on public.course_schedule_notifications
      for all
      using (false)
      with check (false);
  end if;
end $$;

notify pgrst, 'reload schema';
