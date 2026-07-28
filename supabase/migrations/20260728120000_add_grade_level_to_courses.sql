-- Courses carry the grade level they are taught at. It drives how many
-- community service hours a tutor earns per class: grade 11/12 courses are
-- worth 2 hours per class, everything else the base 1.5 (see
-- src/lib/serviceHours.ts). Only the founder/CEO/COO can set it.
alter table public.courses
  add column if not exists grade_level smallint;

alter table public.courses
  drop constraint if exists courses_grade_level_range;

alter table public.courses
  add constraint courses_grade_level_range
  check (grade_level is null or (grade_level between 1 and 12));

comment on column public.courses.grade_level is
  'Grade the course is taught at (1-12). Null = unspecified. Grades 11 and 12 earn tutors 2 service hours per class instead of 1.5.';

notify pgrst, 'reload schema';
