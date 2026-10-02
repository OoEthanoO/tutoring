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
On the home server, `yanlearn-zen-gateway` keeps a Discord Gateway connection
open. Joins, moves between channels, and server-mute changes immediately queue
a targeted reconciliation; they no longer wait for the minute-by-minute cron.
The listener uses only Guilds and GuildVoiceStates intents, not message content
or privileged member events. Discord network latency and rate limits still
apply; this is event-driven, not a guarantee of zero milliseconds.

Turning Zen off waits for permission restoration and removal of Zen-owned
server mutes from connected students before reporting success. The Gateway
supplies the connected-member list, avoiding a slow scan of offline members.
If the shared lease is briefly occupied by a voice update, the toggle waits
up to 10 seconds. Discord sync repairs permissions and retries incomplete changes. The interface
reports partial failures rather than claiming everything was applied. YanBot
needs **Manage Channels** and **Mute Members**.

Only server mutes applied by Zen are tracked in `discord_zen_mutes`. Turning
Zen off restores those mutes; existing moderator mutes are left alone. When a
student switches to another course, the voice event restores their Zen mute
if their new call is not restricted. Moves between Zen rooms stay muted. A
student becoming a tutor or a class closing is also repaired by regular sync.
Discord cannot unmute a disconnected member through this endpoint, so their
record is kept and restored immediately when they rejoin a non-Zen call. Changes
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

`scripts/zen-gateway.mjs` is bundled by `postbuild` into the standalone release.
The native Windows web supervisor installs its singleton scheduled task on the
first deployment. It always uses the release in `active.json`; it does not run
staged code. The Gateway worker restarts after a release change, catches up all
connected members after login/reconnect, and retains events arriving during
in-flight reconciliation. A busy lease, failed request, or website restart is
retried with bounded backoff. Each request reads current database policy and
current Discord voice state instead of replaying stale event decisions.

The worker only listens on `127.0.0.1:3102`. Its `/voice-members` snapshot and
the website's `/api/internal/zen-voice` endpoint require the server's existing
`CRON_SECRET`. Browser users cannot request arbitrary mutes. The normal website
authorization and origin checks still protect course toggles. If the listener
is unavailable, cron and toggles fall back to REST scanning; channel Speak
restrictions remain in force. No new migration or Recorder release is needed.

`zen-gateway-status.json` reports connection freshness, pending work and the last
successful update without participant identities or credentials. See
`SELF_HOSTING.md` for operational checks. Moderation mutes remain untouched;
Discord cannot distinguish a moderator reapplying an already Zen-owned mute.

The Discord rules follow the official [permission model](https://docs.discord.com/developers/topics/permissions)
and [member mute API](https://docs.discord.com/developers/resources/guild#modify-guild-member).
Tests use mocked Discord calls and local PostgreSQL (PGlite); they do not
change the live server. Verify one live on/off toggle with a tutor and student
after deployment to check YanBot's actual Discord permissions.
