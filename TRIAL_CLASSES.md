# Trial classes

Management (Founder, CEO, COO and their Shadows) can book a guest for one
scheduled class without creating a YanLearn account or a full enrollment.

1. Open **Admin → Manage accounts → Trial classes**.
2. Choose the scheduled class, and enter the student's own name and Discord
   user ID. Discord Developer Mode enables **Copy User ID** on a member.
3. If the student is currently an approved tutor extra account, tick **Replace
   this person's existing tutor-linked approval with this trial**. Saving
   removes that approval and creates the booking in one database transaction.
   Shadows cannot convert an extra account owned by the protected leadership.
4. Share the server invite shown in the panel and the class time. The guest
   can join the server after booking. Changes take effect on the next regular
   Discord sync; the panel does not send a message on the staff member's behalf.

The guest uses their own name. If their Discord ID is already linked to a
verified YanLearn account, that account's name and regular permissions prevail.
An independent guest receives Student, never the tutor's roles or course roles.

Class access opens **5 minutes before** its scheduled start and expires
**30 minutes after** its scheduled end, allowing time for a class to overrun.
The guest can see that course's chat and join only that class's voice channel
and breakout rooms. Tutors' breakout splitting includes current trial guests.
Trial students do not count as tutors, regular enrollments, or absent enrolled
students. Website exercises/recordings still require the usual website account
and enrollment; a Discord trial does not grant access to those private APIs.

**Revoke trial** removes access on the next sync. Expiry does the same
automatically. Unlinked guests are removed from the server when they have no
remaining scheduled/open trials. Linked users and approved tutor extra
accounts retain their normal membership. A revoked/expired attendee already
in voice is disconnected only if they have no other permission to remain.
No trial operation deletes the class's voice channel.

**Show expired and revoked trials** displays the booking history. Rebooking
the same person for the same class reuses the row. Class reschedules change
the access window automatically. Deleted/cancelled courses withdraw access;
deleted classes retain a guest-identity tombstone for permission cleanup.

## Deployment

Apply `supabase/migrations/20260926160000_create_class_trials.sql` **before
pushing to master**. It adds a service-only `class_trials` table and booking
RPC, and guards against simultaneously assigning the same ID as a trial guest
and a tutor alias. Existing approved accounts are not converted automatically:
staff must choose the intended class and confirm replacement in the form.

The booking RPC checks the database clock, locks the Discord identity and
class, and verifies the expected previous owner during conversion. Up to 80
distinct upcoming/current trial guests can be booked per course, leaving
space for staff and bot channel permissions. Browser roles cannot read/write
the table or execute the RPC; management authorization is checked by
`/api/admin/class-trials` using the real session actor.

`classTrials.ts` owns access windows and member permission rules;
`classTrialsServer.ts` reads the complete paginated snapshot. `discordSync.ts`
owns guest membership, nicknames, course chat and existing voice/breakout
access. The class-reminders cron includes guests when creating/recovering
voice channels. Snapshot read failures preserve existing access instead of
treating the guest list as empty. Trial permissions are individual channel
overwrites, following [Discord's permission model](https://docs.discord.com/developers/topics/permissions).

Validation covers the real PostgreSQL migration with PGlite, management and
Shadow authorization, the booking form, the actual Discord sync with a mocked
guild, window boundaries, expiry/revocation, normal enrollments and breakout
participation. No production Discord messages or membership changes are made
by these tests.
