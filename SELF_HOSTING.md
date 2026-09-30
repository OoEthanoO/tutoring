# YanLearn on finprint-host

Migration status (September 30, 2026): the runtime layout is installed, but
production credentials are being recovered from the service providers after
Vercel rejected the transfer deployment with "Account is blocked." Public DNS still points to Vercel.
The initial cutover and automatic deployment are not enabled yet.

Native Windows hosting uses Node 24, the Next.js standalone build, Task
Scheduler, and the server's existing Caddy HTTPS proxy. Supabase, email,
Discord, and private recording storage remain the same services. This moves
the website and API runtime; it does not move the database or recording files.

## Runtime layout

Everything is under `C:\ProgramData\YanLearn`, restricted to Administrators
and SYSTEM. Keep this directory out of Git and backups intended for sharing.

- `repo`: a dedicated deployment checkout, not a development checkout.
- `secrets\production.json`: an object of production environment names/values.
- `server.json`: executable paths and the existing main Caddyfile path.
- `releases\<revision>-<time>\app`: an isolated standalone Next.js build.
- `releases\<revision>-<time>\ops`: that release's web runner.
- `static`: retained immutable Next.js chunks for browsers open across updates.
- `active.json`, `previous.json`, `prepared.json`: release metadata, no secrets.
- `ops`: deployment, status, and rollback scripts.
- `logs`: build, service, proxy, and deployment logs.

The website listens on loopback only, alternating ports 3100 and 3101. Caddy
serves `learn.ethanyanxu.com` and proxies requests to the healthy release. It
retains the existing configuration for the other hosted sites and the VPN.

## Initial installation

Run from an Administrator PowerShell on finprint-host, using the actual
existing Caddy executable and main configuration paths:

```powershell
.\deploy\windows\install.ps1 -CaddyExe C:\Users\ethan\AppData\Local\Microsoft\WinGet\Links\caddy.exe -MainCaddyfile C:\Users\ethan\finprint\scripts\selfhost\Caddyfile
```

Import the production settings into `secrets\production.json`. Never print
the values, commit them, or rotate existing credentials without updating their
other consumers. The deploy script checks required settings before building.
Use the unchanged `https://learn.ethanyanxu.com` site URL and Discord OAuth
redirect so existing logins, Recorder clients, and emailed links keep working.

Prepare a release without changing public traffic:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\YanLearn\ops\deploy.ps1 -PrepareOnly
```

Verify the prepared loopback server, database-backed reads, Recorder CORS,
authentication checks, static assets, and certificate template before cutover.
Then install the Caddy route using the prepared release:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\YanLearn\ops\rollback.ps1 -ActivatePrepared
```

Only after those checks pass, change the `learn` DNS record to a CNAME pointing
to `finprint.ethanyanxu.com` (the existing automatically updated home-server A
record). Verify authoritative DNS, a valid public HTTPS certificate, and
`/api/health` returning the exact commit with `hosting: finprint-host`. Keep
the previous Vercel deployment available until the cutover is confirmed.

## Local class-reminders scheduler

The previous scheduler is cron-job.org. Disable that job before enabling the
local replacement; do not run both. Once a healthy release is active, rerun
`install.ps1` with `-EnableReminders -ExternalRemindersDisabled` (and the same
Caddy paths). This registers `yanlearn-reminders` as SYSTEM, at startup and
every minute. It posts to the active release's loopback address with the
existing `CRON_SECRET`, so neither public DNS nor an interactive login is needed.

Task Scheduler and a file lock prevent overlapping local runs. The request
waits for server completion rather than timing out and launching another run
while the first one still works. Deployment waits for this lock before
retiring an old process. Check `reminders-status.json` and
`logs\reminders.log` for completion, duration and error counts; details remain
in the website's sync health view. If a run remains `running` unusually long,
inspect the web logs before stopping anything: stopping the scheduler alone
does not cancel server-side work. These protections cover the local scheduler;
keep all previous external jobs disabled.

## Subsequent deployments

After the first verified cutover, rerun `install.ps1` with `-EnableAutoDeploy`.
This creates `yanlearn-deploy`, a SYSTEM task that polls `master` each minute.
Disable Vercel Git deployments only after home-server deployment is verified.
Apply any Supabase migration before pushing code that reads the new schema.

The deployer serializes builds with a file lock, builds without stopping the
current server, starts the new release on the spare loopback port, checks its
commit and a database-backed endpoint, and switches Caddy only after success.
The old process is retired after a five-minute drain for in-flight cron work
and recording streams. Failed builds leave the
current release serving traffic. No releases or shared assets are deleted
automatically; monitor disk usage and retain a known-good rollback release.

The release's `yanlearn-web-*` SYSTEM task starts at boot and restarts Node
after failures. Deployment does not depend on a user remaining signed in.
`ops\smoke.ps1` verifies startup, loopback binding, process cleanup, rollback
restart and atomic state updates with an isolated fixture on port 3199. It
requires administrator access and cleans up its temporary task and files.

```powershell
# Show local/public health, task state and exact revision.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\YanLearn\ops\status.ps1

# Deploy immediately.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\YanLearn\ops\deploy.ps1

# Stop automatic deployment while investigating or rolling back.
Disable-ScheduledTask -TaskName yanlearn-deploy

# Restore the previous healthy release and its Caddy upstream.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\YanLearn\ops\rollback.ps1
```

Re-enable `yanlearn-deploy` after reverting/fixing the bad commit on `master`.
Otherwise the poller will try to deploy that commit again. Inspect
`logs\deploy.log`, `logs\poller.log`, `logs\web-3100.log`, `logs\web-3101.log`,
and `logs\access.log` when investigating. These logs are private operational
data; do not publish them without reviewing/redacting their contents.

## Connecting from outside the home

The `finprint-host` SSH alias points at `192.168.18.10`. YanVPN's REALITY
client must route `192.168.18.0/24` through its `proxy` outbound before its
general private-address `direct` rule. A client profile reinstall can replace
that setting. The September 2026 migration adds this narrow rule to the
installed client and keeps the original backup in the protected YanVPN folder.
Do not expose SSH publicly or disable host-key checking to work around routing.
