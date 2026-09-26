# YanLearn (tutoring)

Free online tutoring platform (learn.ethanyanxu.com). Next.js App Router +
Supabase (Postgres/RLS) + Discord bot integration. Hosted on Vercel: **pushing
to `master` deploys to production** (August 2026 — there is no `vercel.json`
any more, so the project's Git settings govern). A commit is a deploy: apply
Supabase migrations BEFORE pushing code that reads the new schema. Vercel runs
no crons — the class-reminders tick is invoked externally with a `CRON_SECRET`
bearer (see the `cron:reminders:*` npm scripts).

## Commands

- Install: `npm ci --allow-remote=all` (the `xlsx` dependency is a remote
  tarball; plain `npm ci` fails when remote fetches are disabled).
- Build: `npm run build` (prebuild runs `scripts/generate-commits.js`, which
  creates `src/generated/commits.json` — typecheck fails until it exists).
- Typecheck: `./node_modules/.bin/tsc --noEmit`
- Lint: `./node_modules/.bin/eslint src`
- Tests: `npm test` (Vitest; pure logic and API authorization tests in `src/lib/`,
  Recorder helpers, and exercise interface tests using jsdom. The exercise
  migration and RPC timing rules also run in PostgreSQL via PGlite).
- Local dev needs `.env.local` (Supabase URL/keys, Discord bot token); without
  it the app cannot run against data.
- Recorder app: `cd recorder && npm install && node scripts/fetch-ffmpeg.mjs &&
  npm run icons && npm run dev` (Node 20 + Rust stable; macOS also needs the
  Swift helper — see `RECORDER.md`).

## Architecture

- `src/app/api/**` — route handlers. Admin routes gate on
  `isFounder(resolveUserRole(...))` — founder/CEO/COO and their Shadows — via
  `getRequestAuthContext`/`getRequestUser` + `getAdminClient` from
  `src/lib/authServer.ts`. Client admin components use the same `isFounder`
  gate. Sessions resolve custom roles centrally. `isTopLeadership` identifies
  the protected founder/CEO/COO tier; `isFounder` is the management-access gate.
  Shadows cannot change top leadership access, impersonate them, ban/delete
  them, transfer their Discord identities, or grant top-tier roles. Enforce
  this server-side with `accountProtection.ts`, including custom-role aliases.
- `src/lib/discordSync.ts` — single owner of Discord guild state. Each run
  kicks human members not linked to a website account (unless listed in
  `approved_discord_accounts`), manages roles (base + per-course), channels,
  and nicknames. Aborts if the approved-accounts table is missing (by design).
  Every member's nickname is their YanLearn name at every rank (a second
  account takes its owner's); the server owner is skipped, since Discord never
  lets a bot rename them.
  Anything it does not manage is deleted, so removing a role or channel from
  this file is how you retire it. The supplementary Social Media / Science
  Tutor / Math Tutor / Nonprofit Team / Development Team roles and channels
  were retired that way in September 2026 — do not re-add them. Only the
  Founder, CEO and COO may ping @everyone/@here: each run strips "Mention
  @everyone, @here, and All Roles" from every other role (shadows included),
  and YanBot's own posts never parse @everyone (`src/lib/discordMentions.ts`).
- `src/app/api/cron/class-reminders/route.ts` — cron tick (auth:
  `CRON_SECRET` bearer). Runs the Discord sync, sends email/Discord reminders,
  and creates/updates temporary live class voice channels under the "Live"
  category (tutor early access 15 min before start, students 5 min). Persists
  a sync health snapshot to `site_settings.discord_sync_status` (shown in
  Admin → Manage accounts → Admin Tools; sync failures do not send Discord
  notifications). Also records attendance from voice states and warns absent
  tutors/students — see `CLASS_PRESENCE_WARNINGS.md`; the timing rules are
  pure functions in `src/lib/tutorPresence.ts`. Tutors can open breakout
  rooms from My classes: extra voice channels in the Live category that copy
  the class channel's access (`discord_breakout_rooms`,
  `src/lib/breakoutRooms*.ts`, `api/classes/[classId]/breakout-rooms`). Being
  in any of a class's rooms counts as being in the class for attendance, tutor
  warnings, live-channel cleanup and the Recorder (`isInClassCall`); rooms are
  deleted with their class channel, and orphans are swept each tick.
  Live voice channels must never be deleted before the current class end.
  Their 5-minute empty and 30-minute tutor-absence clocks start only afterwards
  (`discordLiveChannels.ts` / `liveChannelCleanup.ts`). Guild sync preserves
  Live-category channels even if their registry query fails or creation is in
  flight; unknown orphan channels are retained. Recorder ticks must not finalize
  a class over a premature channel deletion or failed database lookup.
- `src/components/DashboardMenus.tsx` — home page tab router; admin panels
  live in `AdminUserManager.tsx` (Admin → Manage accounts). Admin Tools
  there includes "Course needs": the trio types courses nobody teaches yet,
  YanBot asks the tutors to send course requests in the executives channel
  (never the everyone channel; the obsolete Chief Executive role is never
  pinged), and the courses stay on a running list (`course_needs` table) that
  every executive sees in Course requests until the trio removes them. Adding is what announces — a
  course already on the list is not announced twice (`src/lib/courseNeeds.ts`,
  `api/course-needs`, `CourseNeedsList.tsx`).
- Founder-taught courses ran on Schoolhouse rather than Discord; from
  2026-09-08 (Toronto) their classes use the same live voice channels,
  reminders and attendance as everyone else. The rule is per class, not per
  course, and lives in `classUsesDiscordVoiceSystem`
  (`src/lib/discordLiveChannels.ts`) — see `ZOOM_INTEGRATION.md`.
- `src/lib/roles.ts` — role model: student/executive tiers up to founder;
  `founderEmails` is hardcoded there. Junior Executive was retired in
  September 2026: an executive who owns or co-teaches no course holds the
  **Pending** Discord role instead of Executive — never both — unless the trio
  ticks "Executive without a course" (`app_users.pending_role_exempt`) in
  Manage accounts. The rule is `src/lib/executiveStanding.ts`; `discordSync`
  applies it and deletes the old Junior Executive guild role. CEO Shadow and
  COO Shadow are seeded management roles with separate identities below both
  CEO and COO. See `LEADERSHIP_SHADOWS.md` for the protected account operations,
  migration, and Discord permission limits.
- `recorder/` — **YanLearn Recorder**, the Tauri 2 desktop app (macOS +
  Windows) tutors must run for every class from 2026-09-09; see `RECORDER.md`.
  Server side: `src/app/api/recorder/**` (bearer-token endpoints the app calls),
  `src/app/api/recordings/**` (student playback: token + range-proxy stream),
  `src/lib/recorderPolicy.ts` (phases / lock / compliance / 7-day expiry — pure,
  unit tested), `src/lib/recordings.ts` (access checks, playback tokens, expiry
  sweep). Recording is per course: `courses.recordings_enabled` (copied from
  the tick on the course request, changeable later by the trio in Manage
  courses). A course with it off is invisible to the recorder — the tick never
  claims its classes, the cron never warns its tutor, and the dashboard notice
  is hidden. Courses that existed before September 2026 were migrated to off. The class-reminders cron runs the expiry sweep and the "recorder not
  open" warning. Recordings live in a private S3-compatible bucket (Cloudflare R2 /
  Backblaze B2 free tier — `src/lib/recordingStorage.ts`, env `RECORDINGS_S3_*`;
  Supabase Storage is deliberately not used) and are only reached through the
  stream endpoint (per-viewer token → 2-minute presigned URL). Release builds come from
  `.github/workflows/recorder-release.yml` on `recorder-v*` tags; installed apps
  then update themselves from that release's signed `latest.json`, but only
  while no class is armed, recording, or uploading (see "Automatic updates" in
  `RECORDER.md`). First-time installs use the public `/recorder` page, whose
  stable platform links resolve the recommended installer from the latest release.
  Tutors can record the whole display or only windows they tick, in which case
  only the focused shared window is recorded and anything else freezes the
  picture. A shared window is captured on its own — Windows.Graphics.Capture /
  ScreenCaptureKit, never a crop of the screen — so notifications and windows
  drawn over it stay out of the recording (`windowfeed.rs`,
  `recorder/wincapture/main.swift`); never add a crop fallback.
- Recorder macOS releases require the Apple signing/notarization secrets in
  `MACOS_NOTARIZATION.md`. The workflow uploads to a draft, checks the app,
  recording helpers, updater archive and notarized DMG, then publishes only
  after both platforms pass. Keep the updater signing key unchanged.
- In-class exercises: Recorder's `exercises.js` panel uses `/api/recorder/exercises`;
  enrolled students use the single `/class-exercises/[classId]` link and private
  `/api/class-exercises/[classId]` endpoints. See `CLASS_EXERCISES.md`. Exercises
  work even with course recordings off. All mutations use the service-only
  `class_exercise_action` RPC with a shared room lock and database clock; never
  replace that with separate check-then-write queries. Students see only their
  own attempts. The first question announces the link in the course channel;
  later questions reuse it. Practice mode stays local with no exercise API calls.

## Conventions

- Migrations: `supabase/migrations/<timestamp>_<name>.sql`; every table gets
  `enable row level security` + a deny-all policy (access is service-role
  only). Apply migrations to Supabase BEFORE deploying code that references
  the new schema.
- Reading a whole table: Supabase silently truncates every response at the
  project's max rows (1000 by default), and a long `.in()` id list is rejected
  for URL length. Use `fetchAllRows` and `chunks` from
  `src/lib/supabasePaging.ts` (see `api/admin/users`).
- Feature/ops docs are root-level `*.md` files (e.g. `ZOOM_INTEGRATION.md`,
  `DISCORD_APPROVED_ACCOUNTS.md`).
- Root-level `*.js`/`*.mjs` scripts are ad-hoc DB utilities that read
  `.env.local` (service role) — not part of the app.
