# YanLearn on finprint-host

Migration status (September 30, 2026): YanLearn is running on finprint-host.
Database access, Recorder CORS, protected routes and public HTTPS at the home
address have passed checks. Caddy obtained a valid Let's Encrypt certificate
for `learn.ethanyanxu.com`. Commit notifications use the Git history bundled
in each deployed build when `GITHUB_TOKEN` is absent; no personal GitHub token
is required. Missed commits are announced oldest first, up to 15 per tick,
and already announced commits are skipped. Token-based GitHub polling remains
available when configured. The local scheduler status includes GitHub sync
success, processed count, skip reason and error count.
The local reminders task is enabled after the owner disabled cron-job.org,
and real runs complete with no Discord sync or Live-category cleanup errors.

The domain registry now delegates `ethanyanxu.com` to Cloudflare. Both
authoritative nameservers and Google's/Quad9's resolvers return the home
address for `learn`; some cached resolvers still return Vercel during the
transition. A successful direct-origin HTTPS check alone does not prove that
every visitor's DNS has refreshed. Vercel's existing deployment is paused by
its account restriction. See the DNS section below for the preserved records
and the replacement home-address updater.

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

Browser mutation origin checks use `NEXT_PUBLIC_SITE_URL` through
`src/lib/requestOrigin.ts`. Do not compare a browser's HTTPS Origin directly
with `request.url`: the standalone server can see its loopback HTTP address.
Breakout rooms, exercise submissions and Zen mode share this check; untrusted
Host/forwarded headers must not expand the allowed origins. Requests still
require their existing session and course permissions.

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

`RESEND_API_KEY` needs Resend's **Full access** permission for Admin's email
history list and message viewer. A domain-scoped Sending access key can deliver
emails, but Resend rejects history reads with `restricted_api_key`. The API key
stays server-side; the email history endpoints retain their leadership role gate.

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

## Cloudflare DNS and dynamic home address

The registrar remains Vercel, but authoritative DNS is now Cloudflare:
`christian.ns.cloudflare.com` and `pat.ns.cloudflare.com`. All 24 previous
records were copied and `learn CNAME finprint.ethanyanxu.com` was added.
All 25 records are DNS-only, with their original 60-second TTLs. Existing
website routes, wildcard/apex destinations, email MX/SPF/DKIM, verification
TXT records and CAA records were preserved. The apex ALIAS is represented by
Cloudflare's flattened CNAME. This does not move other Vercel-hosted websites.

The SYSTEM task `ethanyanxu-cloudflare-ddns` runs at boot and every five
minutes. `ops\update-cloudflare-dns.ps1` updates only the pinned `ai` and
`finprint` A records, after two independent services confirm the same public
IPv4. It validates record identity and DNS-only status before writing and
verifies updates afterward. `learn` and `history` follow those A records via
CNAMEs. The token has DNS-write permission only for this zone, is encrypted
with Windows DPAPI, and is readable only within the protected runtime folder.

- Configuration: `secrets\cloudflare-ddns.json` (zone and record IDs).
- Encrypted token: `secrets\cloudflare-dns-token.dpapi`.
- Latest result: `secrets\cloudflare-ddns-status.json` and Task Scheduler's
  `LastTaskResult` (zero means success).
- Token expires September 15, 2027; replace it before that date.
- Reinstall the task using `ops\install-cloudflare-dns.ps1` after restoring
  its protected configuration and token on this same Windows host. DPAPI
  ciphertext is not portable to a different Windows installation.

The legacy `yanvpn-vercel-ddns` and `yanai-ddns` tasks temporarily continue
updating the old Vercel zone so visitors using cached old nameservers still
reach the current home address. Retire these only after the nameserver
transition has completed; leave the Cloudflare updater enabled. A backup of
the original DNS is in `secrets\dns-vercel-before.json`. Restoring the old
nameservers would also restore the old Vercel destination for `learn`.

## Subsequent deployments

After the first verified cutover, rerun `install.ps1` with `-EnableAutoDeploy`.
This creates `yanlearn-deploy`, a SYSTEM task that polls `master` each minute.
`vercel.json` disables Vercel Git deployments now that the home server is serving.
Apply any Supabase migration before pushing code that reads the new schema.

The deployer serializes builds with a file lock, builds without stopping the
current server, starts the new release on the spare loopback port, checks its
commit, a database-backed endpoint, and the public Letter of Support PDF, and
switches Caddy only after success. Asset directories are merged into the
standalone tree, since Next.js may already have traced some files there. The
letter and service-hours template are also checked against their source hashes.
The old process is retired after a five-minute drain for in-flight cron work
and recording streams. Failed builds leave the
current release serving traffic. No releases or shared assets are deleted
automatically; monitor disk usage and retain a known-good rollback release.

The release's `yanlearn-web-*` SYSTEM task starts at boot and restarts Node
after failures. Deployment does not depend on a user remaining signed in.
`ops\smoke.ps1` verifies startup, loopback binding, process cleanup, rollback
restart and atomic state updates with an isolated fixture on port 3199. It
requires administrator access and cleans up its temporary task and files.
`deploy/windows/assets.test.ps1` checks asset merging and retained files without
administrator access, a running server, or credentials.

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
