# Post-course feedback

Added November 2026. When a course's last class ends, each enrolled student
may fill in a short, optional form about it.

## Rules

1. **When.** The form opens when the course's last class ends and stays open
   30 days (`FEEDBACK_WINDOW_DAYS`). Until it closes the student can change
   their answers or switch to "No thanks". Deleted courses and courses
   imported from before the platform (`courses.is_completed`) never collect
   feedback.
2. **Who.** Only students in `course_enrollments` for that course, answering
   from their own account. Management viewing the site as a student cannot
   answer for them.
3. **What.** Course rating 1-5, tutor rating 1-5, pace (too slow / about
   right / too fast), whether they would take another YanLearn course (yes /
   maybe / no), which course next (200 characters) and comments (2000
   characters). Every question is optional, but a submission that is not
   "No thanks" must answer at least one. "No thanks" is stored as
   `declined_at` with every answer empty.
4. **Who sees it.** Management (the `isFounder` gate) sees every response
   with the student's name in Admin → Course feedback. The course's tutors
   (owner and co-tutor) see the answers in Teaching → My courses without
   names, without times and in an order that follows neither, and only once
   the form has closed; until then they see neither the answers nor how many
   there are.
5. **Invitation.** The class-reminders cron sends each course's students one
   email soon after the last class (within two days of it, so a course that
   ended before this feature is never emailed). The course is claimed in
   `courses.feedback_invited_at` before sending, so overlapping ticks cannot
   send it twice, and a failed send is reported in the tick's JSON, not
   retried: the form also waits at the top of My enrollments.

## Where it lives

- Rules (pure, unit tested): `src/lib/courseFeedback.ts`.
- Database reads and the invitation: `src/lib/courseFeedbackServer.ts`.
- Migration: `supabase/migrations/20261122120000_course_feedback.sql`
  (`course_feedback`, `courses.feedback_invited_at`). Apply it before
  deploying this code.
- Routes: `api/course-feedback` (the student's open forms; POST answers or
  `{ declined: true }`), `api/course-feedback/tutor`,
  `api/course-feedback/manage`. Tests: `api/courseFeedbackRoutes.test.ts`.
- Pages: `CourseFeedbackCard.tsx` (top of My enrollments),
  `TutorCourseFeedbackCard.tsx` (My courses), `CourseFeedbackMenu.tsx`
  (Admin → Course feedback), shared `CourseFeedbackAnswers.tsx`.
- Cron: the "Post-course feedback" step in
  `api/cron/class-reminders/route.ts` (`feedbackInvites` in its response).
- Tutor handbook: "Course feedback" in `ReadmeMenu.tsx`. Families: step 3 of
  `HelpMenu.tsx`.
