-- Paid courses (November 2026). See PAID_COURSES.md.
--
-- Most courses ask families for a donation to SickKids through the tutor's
-- fundraiser link. A paid course instead has a fee that the family pays
-- straight to the tutor. YanLearn never receives or holds that money: the
-- site shows the tutor's payment note, the tutor marks each payment as
-- received, and only then can management approve the enrollment.
--
-- Only senior tutors may teach paid courses, and a paid course earns no
-- community service hours.

-- Set by the founder, CEO or COO in Admin > Manage accounts.
alter table public.app_users
  add column if not exists senior_tutor boolean not null default false;

comment on column public.app_users.senior_tutor is
  'Management-set: this tutor may teach paid courses.';

-- How families pay this tutor (an Interac e-Transfer address, say). Shown
-- only to signed-in users, and only on that tutor's paid courses.
alter table public.tutor_profiles
  add column if not exists payment_note text;

alter table public.tutor_profiles
  drop constraint if exists tutor_profiles_payment_note_length;
alter table public.tutor_profiles
  add constraint tutor_profiles_payment_note_length
  check (payment_note is null or char_length(payment_note) <= 300);

alter table public.courses
  add column if not exists is_paid boolean not null default false,
  add column if not exists paid_fee numeric(10,2);

-- A paid course has a fee and no donation fee; every other course has no
-- paid fee. Keeping donation_fee empty is what hides the donation wording.
alter table public.courses
  drop constraint if exists courses_paid_fee_check;
alter table public.courses
  add constraint courses_paid_fee_check
  check (
    (is_paid and paid_fee is not null and paid_fee > 0 and donation_fee is null)
    or (not is_paid and paid_fee is null)
  );

comment on column public.courses.is_paid is
  'Paid course: the family pays paid_fee straight to the tutor, not to SickKids.';

-- The tutor asks for a paid course on the request; management decides the
-- fee when approving it.
alter table public.course_creation_requests
  add column if not exists is_paid boolean not null default false,
  add column if not exists requested_fee numeric(10,2);

-- Stamped when the tutor marks the payment as received. Approval of an
-- enrollment in a paid course requires it.
alter table public.course_enrollment_requests
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_confirmed_by uuid
    references public.app_users(id) on delete set null;
