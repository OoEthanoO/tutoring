# Installs YanLearn's self-hosted database, loopback only:
# PostgreSQL 17 as the Windows service yanlearn-postgres (NetworkService) and
# PostgREST as the SYSTEM task yanlearn-postgrest behind the managed Caddy
# gateway on 127.0.0.1:3111. Safe to rerun: it never drops an existing yanlearn
# database. Secrets go to secrets\database.json and secrets\postgrest.conf.
[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn')
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'database.ps1')
Assert-Administrator
$layout = Get-DatabaseLayout $Root
$utf8 = New-Object Text.UTF8Encoding $false

Install-PostgresBinaries $Root
Install-Postgrest $Root

$settings = Read-Json $layout.Settings
if (-not $settings) {
    $jwtSecret = New-RandomSecret 48
    Write-Json $layout.Settings ([ordered]@{
        SuperuserPassword = New-RandomSecret 32
        AuthenticatorPassword = New-RandomSecret 32
        BackupPassword = New-RandomSecret 32
        JwtSecret = $jwtSecret
        ServiceRoleKey = New-ServiceRoleKey $jwtSecret
        CreatedAt = (Get-Date).ToUniversalTime().ToString('o')
    })
    $settings = Read-Json $layout.Settings
}

# The YanLearn root admits only SYSTEM and Administrators, and PostgreSQL
# drops administrator rights even when an administrator starts it. The
# binaries are public software; the data folder is NetworkService's alone.
$networkService = '*S-1-5-20'
& icacls.exe $layout.Home /grant "${networkService}:(OI)(CI)RX" '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not grant read access to the PostgreSQL binaries.' }

$configChanged = $false
if (-not (Test-Path -LiteralPath (Join-Path $layout.Data 'PG_VERSION'))) {
    # Without PG_VERSION it is not a cluster, only what a failed initdb left.
    if (Test-Path -LiteralPath $layout.Data) { Get-ChildItem -LiteralPath $layout.Data -Force | Remove-Item -Recurse -Force }
    New-Item -ItemType Directory -Path $layout.Data -Force | Out-Null
    # initdb runs here with a restricted token, as this account minus its
    # Administrators membership, so until then the account needs the data
    # folder and its own copy of the superuser password.
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $layout.Data /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "${networkService}:(OI)(CI)F" "*${me}:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not secure the data folder.' }
    $scratch = Join-Path $Root 'postgres\initdb-scratch'
    New-Item -ItemType Directory -Path $scratch -Force | Out-Null
    & icacls.exe $scratch /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*${me}:(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not secure the initdb scratch folder.' }
    $passwordFile = Join-Path $scratch 'password.txt'
    [IO.File]::WriteAllText($passwordFile, $settings.SuperuserPassword, [Text.Encoding]::ASCII)
    try {
        # Supabase's collation is ICU en-US; scram from the first start, so there
        # is never a moment of password-less "trust" access.
        Invoke-PgTool $layout.Bin 'initdb' @('--pgdata', $layout.Data, '--username', 'postgres', "--pwfile=$passwordFile",
            '--auth', 'scram-sha-256', '--encoding', 'UTF8', '--locale-provider', 'icu', '--icu-locale', 'en-US',
            '--locale', 'en-US', '--lc-messages', 'C', '--data-checksums') | Out-Null
    } finally {
        Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
    }
    & icacls.exe $layout.Data /remove:g "*$me" | Out-Null
    $configChanged = $true
}

$marker = '# YanLearn (managed by install-database.ps1)'
$managed = @"
$marker
listen_addresses = 'localhost'
port = $script:PostgresPort
max_connections = 60
shared_buffers = 256MB
timezone = 'UTC'
log_timezone = 'UTC'
password_encryption = 'scram-sha-256'
# On Windows fsync flushes the drive's write cache; the default
# open_datasync can lose commits on power loss with that cache on (no UPS).
wal_sync_method = fsync
logging_collector = on
log_directory = 'log'
log_filename = 'postgresql-%a.log'
log_truncate_on_rotation = on
log_rotation_age = 1d
log_rotation_size = 0
"@
$confPath = Join-Path $layout.Data 'postgresql.conf'
$conf = [IO.File]::ReadAllText($confPath)
$at = $conf.IndexOf($marker)
$base = if ($at -ge 0) { $conf.Substring(0, $at).TrimEnd() } else { $conf.TrimEnd() }
$newConf = $base + "`r`n`r`n" + $managed + "`r`n"
if ($newConf -ne $conf) { [IO.File]::WriteAllText($confPath, $newConf, $utf8); $configChanged = $true }
$hba = @"
# Managed by install-database.ps1: loopback only, SCRAM passwords only.
# TYPE  DATABASE  USER  ADDRESS       METHOD
host    all       all   127.0.0.1/32  scram-sha-256
host    all       all   ::1/128       scram-sha-256
"@
$hbaPath = Join-Path $layout.Data 'pg_hba.conf'
if ([IO.File]::ReadAllText($hbaPath) -ne ($hba + "`r`n")) { [IO.File]::WriteAllText($hbaPath, $hba + "`r`n", $utf8); $configChanged = $true }

if (-not (Get-Service -Name $script:PostgresServiceName -ErrorAction SilentlyContinue)) {
    Invoke-PgTool $layout.Bin 'pg_ctl' @('register', '-N', $script:PostgresServiceName, '-U', 'NT AUTHORITY\NetworkService',
        '-D', $layout.Data, '-S', 'auto', '-w') | Out-Null
    & sc.exe failure $script:PostgresServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 | Out-Null
    & sc.exe description $script:PostgresServiceName 'YanLearn database: PostgreSQL 17, loopback only.' | Out-Null
}
$service = Get-Service -Name $script:PostgresServiceName
if ($service.Status -ne 'Running') { Start-Service -Name $script:PostgresServiceName }
elseif ($configChanged) { Restart-Service -Name $script:PostgresServiceName }
$deadline = (Get-Date).AddSeconds(60)
do {
    & (Join-Path $layout.Bin 'pg_isready.exe') -h 127.0.0.1 -p $script:PostgresPort -q
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 1
} while ((Get-Date) -lt $deadline)
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL did not start. See postgres\data\log.' }

# Supabase's role model, with its statement limits for API requests.
try {
    Use-LocalDatabase $Root 'postgres' 'postgres'
    $env:YANLEARN_AUTHENTICATOR_PASSWORD = $settings.AuthenticatorPassword
    $env:YANLEARN_BACKUP_PASSWORD = $settings.BackupPassword
    Invoke-Sql $Root @'
do $$ begin
  if not exists (select from pg_roles where rolname = 'yanlearn_owner') then create role yanlearn_owner nologin; end if;
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
  if not exists (select from pg_roles where rolname = 'yanlearn_backup') then create role yanlearn_backup login bypassrls; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant pg_read_all_data to yanlearn_backup;
alter role anon set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';
alter role authenticator set statement_timeout = '8s';
alter role authenticator set lock_timeout = '8s';
\getenv authenticator_password YANLEARN_AUTHENTICATOR_PASSWORD
\getenv backup_password YANLEARN_BACKUP_PASSWORD
alter role authenticator password :'authenticator_password';
alter role yanlearn_backup password :'backup_password';
'@ | Out-Null
    $exists = Invoke-Sql $Root "select count(*) from pg_database where datname = 'yanlearn';" @('-A', '-t')
    if (($exists -join '').Trim() -ne '1') { New-YanLearnDatabase $Root }
} finally {
    Remove-Item Env:YANLEARN_AUTHENTICATOR_PASSWORD, Env:YANLEARN_BACKUP_PASSWORD -ErrorAction SilentlyContinue
    Clear-PgEnvironment
}

# No db-anon-role: requests without a valid service-role JWT are refused.
$postgrestConfig = @"
db-uri = "postgres://authenticator:$($settings.AuthenticatorPassword)@127.0.0.1:$script:PostgresPort/yanlearn"
db-schemas = "public"
db-extra-search-path = "public, extensions"
db-max-rows = 1000
db-pool = 10
server-host = "127.0.0.1"
server-port = $script:PostgrestPort
admin-server-port = $script:PostgrestAdminPort
jwt-secret = "$($settings.JwtSecret)"
log-level = "error"
"@
$configUnchanged = (Test-Path -LiteralPath $layout.PostgrestConfig) -and ([IO.File]::ReadAllText($layout.PostgrestConfig) -eq $postgrestConfig)
if (-not $configUnchanged) { [IO.File]::WriteAllText($layout.PostgrestConfig, $postgrestConfig, $utf8) }

# Like the Zen launcher, bootstrap the supervisor into ops before the first
# deployment that carries it; deployments keep it current afterwards.
foreach ($name in 'postgrest.ps1', 'database.ps1') {
    $target = Join-Path $Root "ops\$name"
    if (-not (Test-Path -LiteralPath $target)) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $target }
}
Register-PostgrestTask $Root
Start-ScheduledTask -TaskName $script:PostgrestTaskName
if (-not $configUnchanged) { Get-Process -Name postgrest -ErrorAction SilentlyContinue | Stop-Process -Force }
if (-not (Test-PostgrestReady 60)) { throw 'PostgREST did not become ready. See logs\postgrest.log.' }

# Gate: loopback-only listeners; anonymous and forged requests refused.
$exposed = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @($script:PostgresPort, $script:PostgrestPort, $script:PostgrestAdminPort, $script:DatabaseGatewayPort) -and $_.LocalAddress -notin '127.0.0.1', '::1' })
if ($exposed) { throw ('Database ports listen beyond loopback: ' + (($exposed | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }) -join ', ')) }
function Get-StatusCode([string]$Uri, [hashtable]$Headers) {
    try { return (Invoke-WebRequest -UseBasicParsing -Uri $Uri -Headers $Headers -TimeoutSec 10).StatusCode }
    catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } return 0 }
}
$api = "http://127.0.0.1:$script:PostgrestPort/"
$anonymous = Get-StatusCode $api @{}
$forged = Get-StatusCode $api @{ Authorization = 'Bearer ' + (New-ServiceRoleKey (New-RandomSecret 48)) }
$service = Get-StatusCode $api @{ Authorization = 'Bearer ' + $settings.ServiceRoleKey }
if ($anonymous -ne 401 -or $forged -ne 401 -or $service -ne 200) {
    throw "PostgREST answered anonymous=$anonymous forged=$forged service=$service; expected 401, 401, 200."
}
$gateway = Get-StatusCode "http://127.0.0.1:$script:DatabaseGatewayPort/rest/v1/" @{ Authorization = 'Bearer ' + $settings.ServiceRoleKey }
Write-Output "PostgreSQL $script:PostgresVersion and PostgREST $script:PostgrestVersion are running on loopback."
Write-Output "PostgREST: anonymous=$anonymous forged=$forged service=$service; Caddy gateway: $gateway (200 once a deploy has written it)."
