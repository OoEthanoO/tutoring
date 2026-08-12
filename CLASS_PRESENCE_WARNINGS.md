# Class presence tracking and warnings

Who is actually in a live class, and what the bot says when someone isn't. All
of it runs inside the class-reminders cron tick
(`src/app/api/cron/class-reminders/route.ts`, ~once a minute); the timing rules
are pure functions in `src/lib/tutorPresence.ts` with tests beside them.

## What is tracked

While a class's live voice channel is active — rows in
`discord_live_class_channels` with `starts_at <= now + 5 min` and
`ends_at >= now - 2 min` — the cron reads Discord voice states:

- **Students** are polled until first detected, then skipped. First sighting
  writes a `class_attendance` row; that row is the attendance record.
- **The tutor** is polled every tick and their `last_seen_at` is refreshed each
  time, because the question for a tutor is not whether they arrived but
  whether they are still there.

A failed voice-state read is never treated as absence — the tick simply learns
nothing and tries again.

## The warnings

| When | Condition | Where it goes |
| --- | --- | --- |
| start − 5 min → start | tutor has never joined | executives channel, mentions the tutor |
| start + 5 min → end | tutor still has never joined | executives channel, sharper: names the strike consequence |
| start → start + 5 min | no student has joined | course text channel, mentions the course role |
| start → end − 5 min | tutor joined, then gone > 1 min | executives channel, mentions the tutor |

Notes on the edges:

- The tutor no-show and left-early paths are mutually exclusive: the no-show
  warnings only apply to a tutor never seen in that class's channel, and the
  left-early warning only to one who was.
- Nothing fires between the start and start + 5 min for the tutor: the earlier
  nudge has gone out and the sharper one is not due yet.
- The "still not joined" message quotes a strike at 10 minutes past the start.
  **Nothing applies that strike automatically** — a founder does, by hand.
- The student nudge is suppressed unless the tick actually determined every
  enrolled student's whereabouts, so an API outage cannot tell a full classroom
  that nobody joined.

## Once per class

Each warning claims a row in `class_reminder_logs` **before** sending, under
one of `tutor_not_joined`, `tutor_still_not_joined`, `students_not_joined`,
`tutor_left_early`. The unique `(class_id, reminder_type)` constraint makes the
claim atomic, so a duplicate insert (a later tick, or two overlapping cron runs)
loses and stays quiet. Claiming first means a failure costs a missed warning
rather than a ping repeated every minute; misses land in the response's
`failedClasses`.

## Strikes

`app_users.strike_count` / `last_strike_at`, set through
`PATCH /api/admin/users` and edited in Admin → Manage accounts. Strikes are
counted, not toggled — the warnings tell tutors that two means removal from the
organization, so the panel has to be able to record the second one. Raising the
count posts a notice to the executives channel mentioning the tutor; clearing or
lowering it notifies nobody. Removal itself is a manual decision.

A tutor with at least one strike also receives the 6-hour class reminder, which
tutors without strikes do not get.

## Limits worth knowing

- **Discord-voice courses only.** Founder-taught and legacy Zoom courses have no
  live channel, so none of this applies to them.
- **Linked Discord accounts only.** A student without one cannot be detected and
  is not counted; a course where nobody has linked Discord is never nudged.
- **One-minute resolution.** Absence has to exceed one poll interval before it
  counts, so "left early" is detected roughly two minutes after the fact.
- **The schedule is a snapshot.** `starts_at` and `ends_at` are copied into
  `discord_live_class_channels` when the channel is created (~15 minutes before
  the class). Rescheduling a class after that leaves this pass working from the
  original times.
