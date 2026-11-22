-- Optional post-course feedback (November 2026). See COURSE_FEEDBACK.md.
--
-- When a course's last class ends, each enrolled student may fill in a short
-- form for the next 30 days: a course rating, a tutor rating, the pace,
-- whether they would take another YanLearn course, which one, and comments.
-- Every answer is optional, and "No thanks" is stored as declined_at.
-- Management (the founder, CEO and COO) sees each response with the
-- student's name; the course's tutors see the answers without names once the
-- form has closed. The rules are in src/lib/courseFeedback.ts.

create table if not exists public.course_feedback (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  student_id uuid not null references public.app_users(id) on delete cascade,
  course_rating smallint check (course_rating between 1 and 5),
  tutor_rating smallint check (tutor_rating between 1 and 5),
  pace text check (pace in ('too_slow', 'about_right', 'too_fast')),
  another_course text check (another_course in ('yes', 'maybe', 'no')),
  next_course text check (next_course is null or char_length(next_course) <= 200),
  comments text check (comments is null or char_length(comments) <= 2000),
  -- "No thanks": the student chose not to answer. A declined row holds no answers.
  declined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, student_id),
  constraint course_feedback_declined_has_no_answers check (
    declined_at is null
    or (course_rating is null and tutor_rating is null and pace is null
        and another_course is null and next_course is null and comments is null)
  )
);

create index if not exists course_feedback_student_idx on public.course_feedback(student_id);

alter table public.course_feedback enable row level security;
drop policy if exists "Deny all access" on public.course_feedback;
create policy "Deny all access" on public.course_feedback for all using (false);

comment on table public.course_feedback is
  'Optional post-course feedback, one row per student and course. Service role only; see COURSE_FEEDBACK.md.';

-- Stamped by the class-reminders cron when it emails a course's students the
-- one invitation to give feedback, so the email never goes twice.
alter table public.courses
  add column if not exists feedback_invited_at timestamptz;

comment on column public.courses.feedback_invited_at is
  'When the post-course feedback invitation email went to the enrolled students.';
