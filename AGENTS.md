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
- Tests: `npm test` (vitest; unit tests for pure logic — `src/lib/`
  (discordSync helpers, live-channel overwrites, roles, recorder CORS) and
  `recorder/src/windowmath.js` (window matching / crop maths). No
  integration/UI tests).
- Local dev needs `.env.local` (Supabase URL/keys, Discord bot token); without
  it the app cannot run against data.
- Recorder app: `cd recorder && npm install && node scripts/fetch-ffmpeg.mjs &&
  npm run icons && npm run dev` (Node 20 + Rust stable; macOS also needs the
  Swift helper — see `RECORDER.md`).

## Architecture

- `src/app/api/**` — route handlers. Admin routes gate on
  `isFounder(resolveUserRole(...))` — the founder/CEO/COO trio — via
  `getRequestAuthContext`/`getRequestUser` + `getAdminClient` from
  `src/lib/authServer.ts`. Client admin components use the same `isFounder`
  gate; keep both sides trio-aligned (decided July 2026).
- `src/lib/discordSync.ts` — single owner of Discord guild state. Each run
  kicks human members not linked to a website account (unless listed in
  `approved_discord_accounts`), manages roles (base + per-course), channels,
  and nicknames. Aborts if the approved-accounts table is missing (by design).
  Anything it does not manage is deleted, so removing a role or channel from
  this file is how you retire it. The supplementary Social Media / Science
  Tutor / Math Tutor / Nonprofit Team / Development Team roles and channels
  were retired that way in September 2026 — do not re-add them.
- `src/app/api/cron/class-reminders/route.ts` — cron tick (auth:
  `CRON_SECRET` bearer). Runs the Discord sync, sends email/Discord reminders,
  and creates/updates temporary live class voice channels under the "Live"
  category (tutor early access 15 min before start, students 5 min). Persists
  a sync health snapshot to `site_settings.discord_sync_status` (shown in
  Admin → Manage accounts → Admin Tools; sync failures do not send Discord
  notifications). Also records attendance from voice states and warns absent
  tutors/students — see `CLASS_PRESENCE_WARNINGS.md`; the timing rules are
  pure functions in `src/lib/tutorPresence.ts`.
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
  applies it and deletes the old Junior Executive guild role. CEO Shadow is a
  seeded custom role at the Executive permission level: it grants no CEO or
  founder authority and sits alongside the member's Executive/Pending standing.
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
  picture (`windowlist.rs` + `crop`/`stillPath` in `capture.rs`).

## Conventions

- Migrations: `supabase/migrations/<timestamp>_<name>.sql`; every table gets
  `enable row level security` + a deny-all policy (access is service-role
  only). Apply migrations to Supabase BEFORE deploying code that references
  the new schema.
- Feature/ops docs are root-level `*.md` files (e.g. `ZOOM_INTEGRATION.md`,
  `DISCORD_APPROVED_ACCOUNTS.md`).
- Root-level `*.js`/`*.mjs` scripts are ad-hoc DB utilities that read
  `.env.local` (service role) — not part of the app.
