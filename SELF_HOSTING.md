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
Scheduler, and the server's existing Caddy HTTPS proxy. Email, Discord, and
private recording storage remain the same services. Since 2026-10-20 the
database runs here too (see "Database" below); recording files stay in the
S3-compatible bucket.

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

### Immediate Zen mutes

The `yanlearn-zen-gateway` task runs a persistent Discord voice-event listener.
Starting the web release installs it automatically; no Discord messages or
Recorder update are involved. `postbuild` bundles its dependencies into
`app/zen-gateway.cjs`, so the task does not depend on the mutable checkout.
The supervisor holds `zen-gateway.lock` and reads `active.json`. The worker
exits on a release change and the supervisor starts the active version. A
rollback to an older release without the worker bundle leaves cron's existing
Zen handling active. Its stable launcher lives at `ops/zen-gateway.ps1`; it
does not depend on retaining an old release's launcher.

The website reads the worker's connected-member snapshot on loopback port
3102 (`YANLEARN_ZEN_GATEWAY_PORT`, supplied by `run.ps1`). Both directions use
`CRON_SECRET`; do not expose port 3102 in Caddy or the firewall. The worker's
voice event requests target the active website on 3100 or 3101, not public DNS.

Check `zen-gateway-status.json` for `ready: true`, the active commit, an
`updatedAt` within 15 seconds, and no accumulating queue/errors. A stale status
file is not proof the worker is running. Logs are in `logs/zen-gateway.log`;
`status.ps1` shows both. With the production environment imported, running the
active release's `app/zen-gateway.cjs --probe` checks Gateway login read-only:
it does not mute members, open a listener, or write runtime status.

The Gateway library handles heartbeat/reconnect/resume. On reconnect the
worker reconciles everyone currently in voice, including mutes retained while
a student was disconnected. Periodic cron remains the outage fallback.

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

## Database

On 2026-10-20 the database moved from hosted Supabase to finprint-host. The
app still uses `supabase-js`, so the same pieces run locally, all on loopback:

- **PostgreSQL 17.11**: Windows service `yanlearn-postgres` (NetworkService),
  `127.0.0.1:5432`. Binaries in `postgres\17` (from EDB's signed installer),
  data in `postgres\data`, logs in `postgres\data\log`. ICU `en-US` collation
  and UTC like Supabase, SCRAM only, data checksums, `wal_sync_method=fsync`.
- **PostgREST 14.18** (Supabase ran 14.5): SYSTEM task `yanlearn-postgrest`,
  supervised like the Zen gateway (`ops\postgrest.ps1`, `postgrest-status.json`,
  `logs\postgrest.log`), API on `127.0.0.1:3110`, `/live` and `/ready` on
  `3112`. It caps responses at 1000 rows and refuses requests without a valid
  service-role JWT.
- **Gateway**: `supabase-js` calls `SUPABASE_URL/rest/v1/...`, so the managed
  Caddyfile also serves `127.0.0.1:3111` and strips `/rest/v1`. It has no
  access log, because Caddy redacts `Authorization` but not `apikey`.
- **Roles**: every request runs as `service_role` (BYPASSRLS); `anon` and
  `authenticated` exist only because old policies name them and have no
  grants. `yanlearn_owner` owns every object, so SECURITY DEFINER functions
  never run as the superuser, and PUBLIC cannot execute functions.
  `yanlearn_backup` can only read. `auth.uid()`/`auth.role()` are stubs for
  legacy policies.
- **Secrets**: `secrets\database.json` holds the role passwords, the JWT secret
  and the minted service-role key; `secrets\postgrest.conf` holds PostgREST's
  copy.

`production.json` has `SUPABASE_URL=http://127.0.0.1:3111` (read at runtime,
never baked into a build) and that service-role key as
`SUPABASE_SERVICE_ROLE_KEY`. `NEXT_PUBLIC_SUPABASE_ANON_KEY` must stay
non-empty; routes only check that it exists. Recording playback tokens are
signed with `RECORDING_TOKEN_SECRET`.

`install-database.ps1` installs or repairs all of this and never drops the
`yanlearn` database. `status.ps1` shows the service, PostgREST's readiness and
the last backup.

### Migrations

Apply a migration before pushing code that reads it. Copy it to the server
and run `apply-migration.ps1`. It runs the file as `yanlearn_owner`, in one
transaction unless the file has its own `begin`/`commit`, and records its
SHA-256 in `yanlearn_meta.migrations`; then PostgREST reloads its schema.

```powershell
scp supabase/migrations/<file>.sql finprint-host:C:/ProgramData/YanLearn/migrations/
ssh finprint-host "powershell -NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\YanLearn\ops\apply-migration.ps1 -Path C:\ProgramData\YanLearn\migrations\<file>.sql"
```

A schema change made by hand needs `notify pgrst, 'reload schema';`
afterwards, or a PostgREST restart.

### Backups and restore

`backup-db.ps1` runs every 6 hours as the SYSTEM task `yanlearn-db-backup`
(register it with `-Register`):

1. `pg_dump` into `backups\db`, kept 14 days;
2. an AES-256-GCM copy, keyed by the passphrase in
   `secrets\db-backup-passphrase.dpapi` (set with `set-backup-passphrase.ps1`;
   also kept in the owner's password manager), uploaded to the recordings
   bucket under `db-backups/` and kept 60 days. `db-backups/archive/` is never
   pruned.

A failed run, or 26 hours without a successful one, emails
`NEXT_PUBLIC_FOUNDER_EMAIL` (at most every 12 hours). `-Drill` restores the
newest off-site copy into a scratch database. To recover elsewhere, decrypt
a downloaded copy with `node scripts/db-backup.mjs decrypt <in> <out>`
(passphrase in `DB_BACKUP_PASSPHRASE`). Then
`pg_restore --no-owner --no-privileges` it into a new database, and rerun
the privilege statements in `database.ps1` (`$PrivilegesSql`).

### Rotating the service-role key

1. Replace `JwtSecret` in `secrets\database.json`.
2. Mint a key with `New-ServiceRoleKey` (in `database.ps1`) and store it as
   `ServiceRoleKey` there and as `SUPABASE_SERVICE_ROLE_KEY` in
   `production.json`.
3. Rerun `install-database.ps1`, which rewrites `postgrest.conf` and restarts
   PostgREST.
4. Redeploy or restart the web release.

### The move, and rolling it back

- **Copy:** `db-restore.ps1` copies Supabase's `public` schema and proves the
  copy: object counts, per-table checksums, privileges, and the app's own
  query shapes through both endpoints (`scripts/compare-databases.mjs`).
  `-Mode Trial` also runs writes and a copy of the active release on port 3199.
- **Cutover:** `db-cutover.ps1` freezes writes, waits until Supabase is quiet,
  makes the final copy, switches `production.json` and restarts the release.
  Supabase's settings stay in `secrets\production.supabase.json`.
  `start-db-cutover.ps1` runs it as a SYSTEM task, so a dropped SSH session
  cannot interrupt it. The 2026-10-20 cutover took 1 minute 36 seconds of
  maintenance page.
- **Rollback:** `start-db-cutover.ps1 -Rollback` points the site back at
  Supabase. It is clean only before the new database takes writes worth
  keeping; after that, the data must be copied back first.
- **Safety copy:** `backups\supabase` holds the pre-move archive of Supabase.

### Local development

The database is not reachable from the network. Tunnel to the gateway and
use the service-role key from `secrets\database.json` in `.env.local`:

```bash
ssh -N -L 3111:127.0.0.1:3111 finprint-host
```

```
SUPABASE_URL=http://127.0.0.1:3111
SUPABASE_SERVICE_ROLE_KEY=<ServiceRoleKey from secrets\database.json>
NEXT_PUBLIC_SUPABASE_ANON_KEY=unused
```

The tunnel reaches production data, so treat local writes as real.

## SSH access

finprint-host (Windows computer name `windows`) runs Windows' built-in OpenSSH
9.5 on port 22 at `192.168.18.10`. Log in as `ethan` with a key. Sessions are
elevated, so the `ops` commands above work over SSH. A client entry:

```
# Windows' built-in OpenSSH 9.5 rejects WarnWeakCrypto even in a Host block it
# is not using, which breaks ssh for every host. Keep this first, outside any block.
IgnoreUnknown WarnWeakCrypto

Host finprint-host
    HostName 192.168.18.10
    User ethan
    IdentityFile ~/.ssh/finprint-host_ed25519
    IdentitiesOnly yes
    # Over YanVPN the TCP connect succeeds even when the route is broken.
    ConnectTimeout 20
    # The server offers no post-quantum key exchange; OpenSSH 10.1+ warns otherwise.
    WarnWeakCrypto no-pq-kex
```

The server's ED25519 host key is
`SHA256:tPVs8x8p2P9rYyOFu72wzNX+kBdrmILfYIUqYN/KVYQ` (checked at the server
console, October 2026). Compare it on a new client's first connection.

sshd also offers password login, but `ethan` is a Microsoft account, so it
takes the Microsoft account password, not the PIN.

sshd reads administrators' keys only from
`C:\ProgramData\ssh\administrators_authorized_keys`, not `~\.ssh`. Authorize a
new client from an Administrator PowerShell on the server, or over SSH from a
client that already has access. Append the key as one ASCII line. Never use
PowerShell 5.1's `>` or `>>`: they write UTF-16, which sshd cannot read. sshd
also ignores the file unless only Administrators and SYSTEM can access it:

```powershell
Add-Content -Encoding ascii -Path C:\ProgramData\ssh\administrators_authorized_keys -Value 'ssh-ed25519 AAAA... user@machine'
icacls.exe C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-18:F'
```

The remote shell is Windows PowerShell 5.1, which has no `&&` or `||`. Its
default execution policy blocks scripts, so run them with
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File ...`. The same policy
stops `ethan`'s OneDrive PowerShell profile from loading, so every login prints
a harmless error about it.

## Connecting from outside the home

The `finprint-host` SSH alias points at `192.168.18.10`. YanVPN's REALITY
client must route `192.168.18.0/24` through its `proxy` outbound before its
general private-address `direct` rule. A client profile reinstall can replace
that setting. The September 2026 migration adds this narrow rule to the
installed client and keeps the original backup in the protected YanVPN folder.
Do not expose SSH publicly or disable host-key checking to work around routing.

Without the rule, port 22 still appears to accept the connection (the tunnel
accepts it locally), but no SSH banner arrives. Reinstalling the Windows client
(`install.ps1 -RealityOnly`, October 2026) regenerates `reality.json` without
the rule. Restore it from an Administrator PowerShell:

1. In `C:\ProgramData\yanvpn-client\reality.json`, add the route rule
   `{"ip_cidr":["192.168.18.0/24"],"outbound":"proxy"}` directly ahead of the
   `ip_is_private` → `direct` rule.
2. From that folder, check it with `bin\sing-box.exe check -c reality.json`.
3. Restart the `yanvpn-reality-client` scheduled task.
