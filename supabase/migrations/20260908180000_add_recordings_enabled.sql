-- Whether a course is recorded with YanLearn Recorder.
--
-- Course requests carry the tutor's answer (ticked by default: recordings are
-- mandatory unless someone deliberately unticks it), and approving a request
-- copies that answer onto the course it creates. The trio can change a course's
-- answer afterwards in Manage courses.
--
-- Courses that already exist are migrated to "not recorded": they were created
-- before this was a choice, and turning recording on for a running course
-- without its tutor knowing would be a surprise. The column default is false
-- for the same reason — recording is only ever on because somebody said so.

alter table public.course_creation_requests
  add column if not exists recordings_enabled boolean not null default true;

comment on column public.course_creation_requests.recordings_enabled is
  'Tutor''s answer on the request: record classes with YanLearn Recorder. Copied onto the course on approval.';

alter table public.courses
  add column if not exists recordings_enabled boolean not null default false;

comment on column public.courses.recordings_enabled is
  'Record classes with YanLearn Recorder. False exempts the tutor from the app entirely.';

notify pgrst, 'reload schema';
