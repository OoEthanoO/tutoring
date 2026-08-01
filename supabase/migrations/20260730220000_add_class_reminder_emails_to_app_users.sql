-- Lets tutors opt out of the 24-hour / 1-hour / 15-minute class reminder emails.
-- They are BCC'd on those alongside the enrolled students; turning this off
-- simply drops them from the recipient list. Students cannot opt out, which is
-- enforced in the API rather than here.
-- Defaults to true so every existing tutor keeps receiving reminders.
alter table public.app_users
  add column if not exists class_reminder_emails boolean not null default true;

comment on column public.app_users.class_reminder_emails is
  'Tutors only: when false, the user is left out of class reminder emails. Students are always included regardless of this value.';

notify pgrst, 'reload schema';
