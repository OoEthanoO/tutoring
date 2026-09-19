# Enrollment rejection reasons and reapplication

Apply `supabase/migrations/20260915020000_enrollment_rejection_reasons.sql`
before deploying this change. It adds the nullable `rejection_reason` column
to `course_enrollment_requests`; existing decisions are preserved.

In **Manage enrollment requests**, the founder, CEO, COO, CEO Shadow and
COO Shadow can choose **Reject**, enter a reason, and select **Reject and
email reason**. The server enforces the same management-access gate and
requires a trimmed reason of 1–2,000 characters.

The reason is stored with the decision and emailed to the account that
submitted the application (`student_email`), not the guardian contact on
the form. Email content is HTML-escaped and preserves line breaks. The API
awaits the shared email sender, including its retries, before returning.
If delivery fails, the reviewer sees an error while the saved rejection
and reason remain visible.

Applicants can see the reason in **My enrollments** and the course's enrollment
form. A rejected applicant of any role can submit a new application, subject
to the usual course-capacity and future-class checks. Pending and already
enrolled applicants remain blocked from submitting duplicates.

For courses with a donation link, applicants must open that link before the
enrollment form allows submission, including when reapplying. This resets each
time the enrollment form is opened. Opening the link unlocks submission; the
website does not verify payment. Applicants who already donated for that course
are told they do not need to donate again. Courses without a donation link do
not have this requirement.

Reapplication updates the existing request to pending, refreshes its submission
time and contact details, and clears its old reason and decision date. The old
decision is not deleted before the new form is validated and saved. Management
loads the most recent application form for each course/student pair. Reviewing
a request from an older submission date returns a conflict instead of acting on
the new application. Approving a previously rejected request also clears its
rejection reason.

Regression checks cover management authorization, recipient selection, escaped
multiline reasons, failed email delivery, stale decisions, ordinary-student
reapplication, preservation on failed validation/saving, and the React forms:

```powershell
npm.cmd test -- src/app/api/enrollments/enrollmentReview.test.ts src/components/EnrollmentReview.test.tsx
```
