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
- Tests: `npm test` (vitest; unit tests for pure logic in `src/lib/` —
  discordSync helpers, live-channel overwrites, roles. No integration/UI
  tests).
- Local dev needs `.env.local` (Supabase URL/keys, Discord bot token); without
  it the app cannot run against data.

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
- `src/app/api/cron/class-reminders/route.ts` — cron tick (auth:
  `CRON_SECRET` bearer). Runs the Discord sync, sends email/Discord reminders,
  and creates/updates temporary live class voice channels under the "Live"
  category (tutor early access 15 min before start, students 5 min). Persists
  a sync health snapshot to `site_settings.discord_sync_status` (shown in
  Admin → Manage accounts → Admin Tools; founders channel pinged on OK↔failing
  transitions). Also records attendance from voice states and warns absent
  tutors/students — see `CLASS_PRESENCE_WARNINGS.md`; the timing rules are
  pure functions in `src/lib/tutorPresence.ts`.
- `src/components/DashboardMenus.tsx` — home page tab router; admin panels
  live in `AdminUserManager.tsx` (Admin → Manage accounts).
- `src/lib/roles.ts` — role model: student/executive tiers up to founder;
  `founderEmails` is hardcoded there.

## Conventions

- Migrations: `supabase/migrations/<timestamp>_<name>.sql`; every table gets
  `enable row level security` + a deny-all policy (access is service-role
  only). Apply migrations to Supabase BEFORE deploying code that references
  the new schema.
- Feature/ops docs are root-level `*.md` files (e.g. `ZOOM_INTEGRATION.md`,
  `DISCORD_APPROVED_ACCOUNTS.md`).
- Root-level `*.js`/`*.mjs` scripts are ad-hoc DB utilities that read
  `.env.local` (service role) — not part of the app.
