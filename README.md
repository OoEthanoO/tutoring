# YanLearn

Free online tutoring platform for students in grades 6–12, run by high school
students — live at [learn.ethanyanxu.com](https://learn.ethanyanxu.com).
Classes are taught over Discord; the website handles accounts, courses,
enrollments, scheduling, reminders, and admin tooling.

## Stack

- **Next.js (App Router)** on the native Windows home server `finprint-host`,
  behind Caddy HTTPS. Pushing `master` triggers the local deployer;
  `vercel.json` disables Vercel Git deployments. See `SELF_HOSTING.md`.
- **Supabase (Postgres)** — all tables are RLS-locked with deny-all policies;
  access is service-role only through the API routes.
- **Discord bot integration** — `src/lib/discordSync.ts` continuously
  reconciles the Discord server (membership, roles, channels, nicknames)
  against website data, and the class-reminders cron creates temporary live
  class voice channels and sends reminders.

## Development

```bash
npm ci --allow-remote=all   # xlsx is a remote tarball
npm run dev                 # needs .env.local (Supabase + Discord credentials)
npm test                    # vitest unit tests for pure logic in src/lib/
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/eslint src
```

The build runs `scripts/generate-commits.js` first (creates
`src/generated/commits.json`, which the typecheck also needs).

The class-reminders tick runs every minute through the home server's
`yanlearn-reminders` task using a `CRON_SECRET` bearer. Keep the former
cron-job.org job disabled to avoid duplicate reminders.

## Documentation

- `CLAUDE.md` — architecture map and conventions.
- Feature/ops docs are root-level markdown files, e.g.
  `DISCORD_APPROVED_ACCOUNTS.md`, `ZOOM_INTEGRATION.md`,
  `ZOOM_CRON_SETUP.md`.
- Migrations live in `supabase/migrations/` and must be applied to Supabase
  before deploying code that references the new schema.

## Fundraising

The "Coding for SickKids" campaign donates directly to hospitals through the
SickKids Foundation platform — see the site's home page for the live total.
