# Paid courses

Added November 2026. Most YanLearn courses ask families for a donation to
SickKids through the tutor's fundraiser link. A **paid course** has a fee that
the family pays straight to the tutor instead. YanLearn never receives, holds
or refunds that money: the site only shows how to pay and records that the
tutor says the payment arrived.

## Rules

1. **Only senior tutors teach paid courses.** The founder, CEO and COO tick
   "Senior tutor" on an account in Admin → Manage accounts
   (`app_users.senior_tutor`). In a co-taught course both tutors must be
   senior. The tick cannot be removed while the tutor owns or co-teaches a
   paid course that is still running, and a demotion to student removes it.
2. **The tutor needs a payment note** (`tutor_profiles.payment_note`, at most
   300 characters and 6 lines of plain text), for example an Interac
   e-Transfer address. The tutor edits it under Paid courses in Teaching → My
   courses; management can edit it in Manage accounts. It is sent only to
   signed-in users, only on that tutor's paid courses. It cannot be removed
   while a paid course is running.
3. **Management sets the fee.** The tutor ticks "Paid course" on the course
   request and may suggest a fee (`course_creation_requests.is_paid`,
   `requested_fee`). Approval creates the course with `courses.is_paid` and
   `courses.paid_fee`, and no `donation_fee`. Approval is refused if a tutor is
   not senior or the owner has no payment note.
4. **The tutor confirms each payment before approval.** In the enrollment
   dialog a family sees the fee and the payment note, ticks "I have sent the
   payment to the tutor" and submits the application. The course's own tutor
   then presses **Payment received** in My courses
   (`course_enrollment_requests.payment_confirmed_at` / `_by`). Until then,
   Approve is disabled in Manage enrollments and the API refuses it. Both
   lists update by themselves while they are open (every 5 seconds, and at
   once when the tab comes back; `useLiveRefresh` in `src/lib/useLiveRefresh.ts`),
   so a new request reaches the tutor, and a confirmation unlocks Approve,
   without a reload. Only the
   course owner can confirm, never management, a co-tutor, or management
   viewing the site as the tutor: the money goes to the owner's account.
   A new application from the same family clears the confirmation.
   Management cannot add a student to a paid course by hand.
5. **No community service hours.** Classes of a paid course are left out of
   the tutor's available hours, withdrawals and certificates.
6. **No switching once it matters.** A course can change between paid and
   donation only before its first class starts and while it has no enrolled
   students and no pending requests.

## Where it lives

- Rules (pure, unit tested): `src/lib/paidCourses.ts`. Database reads for
  them: `src/lib/paidCoursesServer.ts`.
- Migration: `supabase/migrations/20261120120000_paid_courses.sql`. Apply it
  before deploying this code.
- Senior tick and payment note for management: `api/admin/users` (PATCH
  `seniorTutor`, `paymentNote`), `AdminUserManager.tsx`.
- Tutor's own payment note: `api/tutor-profile` (GET returns `seniorTutor`
  and `paymentNote`; PATCH saves the note).
- Requests and approval: `api/course-requests`, `CourseCreator.tsx`,
  `api/course-requests/[requestId]/approve`, `CourseRequestsMenu.tsx`.
- Editing a course: `api/courses` PATCH (`isPaid`, `paidFee`),
  `ManageMyCoursesMenu.tsx`.
- Catalog: `api/courses` GET adds `is_paid`, `paid_fee` and, for signed-in
  users, `payment_note`; a paid course never returns a `donation_link`.
  `CoursesMenu.tsx` shows the payment step; `AllCoursesTableMenu.tsx` shows
  "Fee $…".
- Enrollment: `api/courses/[courseId]/enroll` (refuses a paid course with no
  one to pay, tells the tutor by email and a Discord mention with no family
  names), `api/paid-enrollments` (the tutor's list and the confirmation),
  `PaidCoursesCard.tsx`, `api/enrollments/[requestId]` (approval gate),
  `ManageEnrollmentsMenu.tsx`, `api/admin/enrollments` (no manual adds).
- Service hours: `withdrawalRequests.ts` and `api/admin/withdrawals` filter
  with `courseEarnsServiceHours`.
- Tutor handbook: the "Paid courses" section of `ReadmeMenu.tsx`. Family
  instructions: step 2 of `HelpMenu.tsx`.

## Things that are deliberately not here

- No payment processing. Tutors are high school students and the site never
  touches money.
- No refund handling. A refund is between the family and the tutor.
- Teaching hours of paid courses still count in the public impact figures
  (`impactStats.ts`). The SickKids "raised" figure is read from the
  fundraiser page and is not affected.
