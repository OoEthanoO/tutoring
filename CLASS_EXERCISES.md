# In-class exercises

YanLearn Recorder has a **Class exercises** panel. It works for courses with
recordings on or off, and does not depend on the tutor being in a voice channel.

## Using it

1. Sign in to Recorder, choose **Class exercises**, and select the class.
   The list includes classes from the past and next 30 days. Tutors see their
   own and co-taught courses; management can manage any course.
2. Type a question and choose a time limit (3 minutes by default), then select
   **Share question & start timer**. The timer starts immediately.
3. YanBot posts the class link once in that course's Discord channel, mentioning
   only the course role. **Copy class link** is also available. No messages are
   sent to the everyone channel, and subsequent questions do not announce again.
4. Students open that link and sign in to their enrolled YanLearn account. The
   page automatically shows each new question and its countdown. Students can
   see only their own submissions and feedback, never classmates' answers.
5. Recorder shows each responding student's name, answer, and attempt history.
   Choose **Mark correct & send feedback** or **Mark incorrect & send feedback**.
   An incorrect answer can be revised and resubmitted while the timer is open.
   A correct answer is complete; a pending answer must be marked before retrying.
6. Expiry or **Stop timer & freeze submissions** closes submissions, including
   resubmissions. Tutors can still mark and give feedback. Sharing a new question
   also freezes the previous one. Review older questions using the review menu.

Question, answer, and feedback text preserve newlines, tabs and spaces. Student
answers use a monospace editor; Tab inserts four spaces, while Shift+Tab leaves
the field. A page refresh loses an unsent draft, but ordinary question polling
does not overwrite it. Submitted answers and feedback are stored in the database.

The student URL is `/class-exercises/<course_classes.id>` for the entire class.
The login flow returns students to that URL. The timer continues during
disconnections and server checks reject late or stale-question submissions.
Questions cannot be reopened; publish a new question for another timed attempt.

In Recorder's **Try the recorder** mode, the same panel operates entirely in
memory. **Add practice student answer** provides a sample to mark, including a
second attempt after an incorrect mark. It sends no API requests or Discord
messages and creates no public link.

## Deployment

1. Apply `supabase/migrations/20260915010000_class_exercises.sql` in Supabase.
2. Deploy the website code to master.
3. Build and release an updated Recorder through the existing signed release
   workflow. This change does not itself bump the version or create a release tag.

The existing Discord bot/guild settings are sufficient; there are no new secrets.
If an announcement fails, the question is still saved and live. Recorder shows
the error and provides **Retry Discord announcement**, or the tutor can copy the
link. Successful announcements are stored per class; a DB claim prevents parallel
sends, and a stable Discord nonce deduplicates immediate uncertain retries.
The [Discord message API](https://docs.discord.com/developers/resources/message#create-message)
only deduplicates nonces for a few minutes, so a process failure after
sending but before saving the success marker can still cause a duplicate on a
much later retry. It will contain the same class link.

## Access and timing guarantees

- Every new table has RLS with deny-all direct-access policies. Only authenticated
  server routes use the service role. The mutation RPC is not executable by
  `anon` or `authenticated` clients.
- Recorder bearer routes authorize the class owner, co-tutor, or management.
  Student cookie routes require enrollment (tutors can preview), and filter
  submissions by the authenticated student's ID in the database. POST never
  accepts a caller-supplied student identity as authority.
- All mutations lock the class room first, then check `clock_timestamp()` inside
  the transaction. Stop, publish, submission, and grading share that lock order.
  An older transaction cannot use its start time to sneak past the deadline.
- Client-generated UUIDs make publish/submit retries idempotent. Attempt history
  is retained, stale attempts cannot overwrite a resubmission's grade, and the
  database independently verifies enrollment for submissions.
- Limits: 100 questions per class; 10–7,200 seconds per question; 16,000 characters
  per prompt, 30,000 per answer, 10,000 per feedback message. No student code is
  executed or interpreted as HTML.

## Verification

`npm test` includes actual PostgreSQL migration/RPC tests via PGlite, endpoint
authorization and privacy tests, and DOM tests of the actual Recorder module and
student React component. Run `npm run build` and the normal lint checks too.
PGlite is an embedded single-connection PostgreSQL runtime; the queued-request
tests are not a substitute for a production multi-connection load test.
Native Recorder and real Discord delivery need a deployed environment for a
final smoke test; browser fixtures and unit tests never send real messages.
