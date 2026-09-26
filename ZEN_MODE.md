# Zen mode

Tutors and co-tutors can toggle **Zen mode** for their course in **My classes**.
Management can also change it. The setting is saved on the course, so it applies
to the current class and every remaining class until someone turns it off.
Existing courses start with Zen mode off. It works with recordings on or off.

While enabled, regular students and trial guests can listen but cannot speak,
stream audio/video, use soundboards, or post in the voice channel's attached
chat. Discussion belongs in the course text channel, which stays available.
The restrictions apply to the main voice channel and its breakout rooms.
Tutors, co-tutors, their approved extra accounts, management and bots retain
their speaking access. Discord administrators inherently bypass channel
permissions; Zen mode does not demote management or change their roles.

The toggle immediately attempts to update current rooms and server-mute
students already connected. New/recovered rooms start with the restriction.
Discord sync repairs permissions and retries incomplete changes. The interface
reports partial failures rather than claiming everything was applied. YanBot
needs **Manage Channels** and **Mute Members**.

Only server mutes applied by Zen are tracked in `discord_zen_mutes`. Turning
Zen off restores those mutes; existing moderator mutes are left alone. When a
student switches to another course, becomes a tutor, or their class closes,
the next sync restores their Zen mute if their new call is not restricted.
Discord cannot unmute a disconnected member through this endpoint, so their
record is kept and restored on the next sync after they rejoin voice. Changes
to a user's self-mute are never made. A later moderator mute on an already
Zen-muted student is indistinguishable from Zen's mute in Discord's API.

`discord_zen_channels` stores only the affected permission bits. Restoration
uses the current access entries; it never restores revoked trials, deleted
enrollments or old room access. Room deletion itself remains governed by the
existing class lifecycle, never by Zen mode.

## Deployment

Apply `supabase/migrations/20260926180000_add_course_zen_mode.sql` before
pushing to master. Also apply the preceding trial-class migration if it has
not been applied yet. This adds `courses.zen_mode_enabled` and service-only
permission/mute tracking and a short-lived reconciliation lease. Browser roles
cannot access the tracking tables or claim/release the lease.

`POST /api/courses/[courseId]/zen-mode` authorizes the course's actual tutor,
co-tutor or management before saving. It and the regular Discord sync share
the database lease so concurrent toggles cannot race mute ownership. Calls
are bounded; interrupted work can be retried after the lease expires.

The Discord rules follow the official [permission model](https://docs.discord.com/developers/topics/permissions)
and [member mute API](https://docs.discord.com/developers/resources/guild#modify-guild-member).
Tests use mocked Discord calls and local PostgreSQL (PGlite); they do not
change the live server. Verify one live on/off toggle with a tutor and student
after deployment to check YanBot's actual Discord permissions.
