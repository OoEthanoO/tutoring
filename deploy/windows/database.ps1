# Shared by the self-hosted database scripts. Dot-source after common.ps1.
# Deployments copy only deploy\windows\*.ps1 into ops, so SQL lives in the
# scripts themselves rather than in separate files.
$script:PostgresVersion = '17.11'
# EDB's zip binaries are unsigned, but its installer is signed and can unpack
# the binaries without installing a service or creating a cluster.
$script:PostgresInstallerUrl = 'https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64.exe'
# Supabase runs PostgREST 14.5; this is the newest 14.x.
$script:PostgrestVersion = '14.18'
$script:PostgrestRepository = 'PostgREST/postgrest'
$script:PostgresServiceName = 'yanlearn-postgres'
$script:PostgrestTaskName = 'yanlearn-postgrest'
$script:PostgresPort = 5432
# PostgREST's /live and /ready probes; loopback like everything else here.
$script:PostgrestAdminPort = 3112
$script:PgEnvironmentNames = @('PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD','PGSSLMODE','PGSSLROOTCERT','PGAPPNAME','PGCONNECT_TIMEOUT')

function Get-DatabaseLayout([string]$Root) {
    [pscustomobject]@{
        Home = Join-Path $Root 'postgres\17'
        Bin = Join-Path $Root 'postgres\17\bin'
        Data = Join-Path $Root 'postgres\data'
        Backups = Join-Path $Root 'backups'
        Source = Join-Path $Root 'secrets\supabase-source.json'
        SourcePassword = Join-Path $Root 'secrets\supabase-source.dpapi'
        SourceCa = Join-Path $Root 'secrets\supabase-ca.crt'
        Settings = Join-Path $Root 'secrets\database.json'
        PostgrestExe = Join-Path $Root 'postgrest\postgrest.exe'
        PostgrestConfig = Join-Path $Root 'secrets\postgrest.conf'
    }
}

function New-RandomSecret([int]$Bytes = 48) {
    $buffer = New-Object byte[] $Bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
    return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function ConvertTo-Base64Url([byte[]]$Bytes) {
    return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

# PostgREST switches to the JWT's role. Like Supabase's service key, this one
# has no expiry; rotating jwt-secret in secrets\postgrest.conf revokes it.
function New-ServiceRoleKey([string]$Secret) {
    $header = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
    $claims = '{{"role":"service_role","iss":"yanlearn","iat":{0}}}' -f [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $payload = ConvertTo-Base64Url ([Text.Encoding]::UTF8.GetBytes($claims))
    $hmac = New-Object Security.Cryptography.HMACSHA256 (,[Text.Encoding]::UTF8.GetBytes($Secret))
    try { $signature = ConvertTo-Base64Url ($hmac.ComputeHash([Text.Encoding]::ASCII.GetBytes("$header.$payload"))) }
    finally { $hmac.Dispose() }
    return "$header.$payload.$signature"
}

# Machine scope, like the Cloudflare token: any local process could decrypt
# it, so the secrets folder's SYSTEM/Administrators ACL is the real boundary.
function Protect-MachineSecret([string]$Value) {
    Add-Type -AssemblyName System.Security
    $plain = [Text.Encoding]::UTF8.GetBytes($Value)
    try { return [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)) }
    finally { [Array]::Clear($plain, 0, $plain.Length) }
}

function Unprotect-MachineSecret([string]$Path) {
    Add-Type -AssemblyName System.Security
    $sealed = [Convert]::FromBase64String((Get-Content -LiteralPath $Path -Raw).Trim())
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($sealed, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    try { return [Text.Encoding]::UTF8.GetString($plain) } finally { [Array]::Clear($plain, 0, $plain.Length) }
}

# InstallBuilder cannot resolve the account inside an SSH logon ("Invalid
# account WORKGROUP\...") and then fails to write its helper scripts, so the
# installer runs as SYSTEM from a one-off scheduled task instead.
function Invoke-InstallerAsSystem([string]$Work, [string]$Installer, [string[]]$Arguments) {
    $temp = Join-Path $Work 'tmp'
    $result = Join-Path $Work 'installer-exit.txt'
    $inner = Join-Path $Work 'run-installer.ps1'
    New-Item -ItemType Directory -Path $temp -Force | Out-Null
    $argumentList = ($Arguments | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', '
    $body = @(
        "`$env:TEMP = '$temp'; `$env:TMP = '$temp'",
        "`$p = Start-Process -FilePath '$Installer' -Wait -PassThru -ArgumentList @($argumentList)",
        "[IO.File]::WriteAllText('$result', [string]`$p.ExitCode)"
    ) -join [Environment]::NewLine
    [IO.File]::WriteAllText($inner, $body, (New-Object Text.UTF8Encoding $false))
    $name = 'yanlearn-installer-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $inner)
    Register-ScheduledTask -TaskName $name -Action $action -User 'SYSTEM' -RunLevel Highest | Out-Null
    try {
        Start-ScheduledTask -TaskName $name
        $deadline = (Get-Date).AddMinutes(10)
        while (-not (Test-Path -LiteralPath $result) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
    } finally { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
    if (-not (Test-Path -LiteralPath $result)) { throw 'The installer did not finish within 10 minutes.' }
    $code = (Get-Content -LiteralPath $result -Raw).Trim()
    if ($code -ne '0') {
        $log = Get-ChildItem -LiteralPath $temp -Filter 'installbuilder_installer*.log' -Recurse | Select-Object -First 1
        $tail = if ($log) { (Get-Content -LiteralPath $log.FullName -Tail 4) -join ' | ' } else { 'no installer log' }
        throw "The installer exited with code ${code}: $tail"
    }
}

function Install-PostgresBinaries([string]$Root) {
    $layout = Get-DatabaseLayout $Root
    $postgres = Join-Path $layout.Bin 'postgres.exe'
    if (Test-Path -LiteralPath $postgres) {
        $installed = (& $postgres --version) -replace '^.* ', ''
        if ($installed -eq $script:PostgresVersion) { return }
        throw "PostgreSQL $installed is already in $($layout.Home); expected $script:PostgresVersion. Upgrade it deliberately."
    }
    $work = Join-Path $Root ('downloads\postgresql-{0}-{1}' -f $script:PostgresVersion, [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    try {
        $installer = Join-Path $work (Split-Path -Leaf $script:PostgresInstallerUrl)
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $script:PostgresInstallerUrl -OutFile $installer
        $signature = Get-AuthenticodeSignature -LiteralPath $installer
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'EnterpriseDB') {
            throw "Unexpected installer signature: $($signature.Status) $($signature.SignerCertificate.Subject)"
        }
        $extracted = Join-Path $work 'extracted'
        Invoke-InstallerAsSystem $work $installer @('--mode', 'unattended', '--unattendedmodeui', 'none',
            '--extract-only', '1', '--prefix', "`"$extracted`"")
        $version = (& (Join-Path $extracted 'bin\postgres.exe') --version) -replace '^.* ', ''
        if ($version -ne $script:PostgresVersion) { throw "The download is PostgreSQL $version, not $script:PostgresVersion." }
        # Only the server and command-line tools are kept.
        foreach ($extra in 'pgAdmin 4', 'stackbuilder', 'StackBuilder') {
            Remove-Item -LiteralPath (Join-Path $extracted $extra) -Recurse -Force -ErrorAction SilentlyContinue
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $layout.Home) -Force | Out-Null
        Move-Item -LiteralPath $extracted -Destination $layout.Home
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# libpq reads these, so the password never reaches a command line or a log.
function Use-SupabaseSource([string]$Root) {
    $layout = Get-DatabaseLayout $Root
    $source = Read-Json $layout.Source
    if (-not $source -or -not (Test-Path -LiteralPath $layout.SourcePassword)) { throw 'Run set-database-source.ps1 first.' }
    $env:PGHOST = $source.Host
    $env:PGPORT = [string]$source.Port
    $env:PGUSER = $source.User
    $env:PGDATABASE = $source.Database
    $env:PGPASSWORD = Unprotect-MachineSecret $layout.SourcePassword
    if (Test-Path -LiteralPath $layout.SourceCa) { $env:PGSSLMODE = 'verify-full'; $env:PGSSLROOTCERT = $layout.SourceCa }
    else { $env:PGSSLMODE = 'require'; Remove-Item Env:PGSSLROOTCERT -ErrorAction SilentlyContinue }
    $env:PGAPPNAME = 'yanlearn-migration'
    $env:PGCONNECT_TIMEOUT = '20'
}

function Clear-PgEnvironment {
    foreach ($name in $script:PgEnvironmentNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
}

# Returns the tool's output; PowerShell 5.1 would otherwise turn every
# stderr notice into a terminating error under Stop.
function Invoke-PgTool([string]$Bin, [string]$Tool, [string[]]$Arguments) {
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $output = @(& (Join-Path $Bin "$Tool.exe") @Arguments 2>&1 | ForEach-Object { "$_" }) }
    finally { $ErrorActionPreference = $oldPreference }
    if ($LASTEXITCODE -ne 0) { throw ("$Tool failed with exit code ${LASTEXITCODE}: " + (($output | Select-Object -Last 6) -join ' | ')) }
    return $output
}

function Add-PostgresToPath([string]$Root) {
    $bin = (Get-DatabaseLayout $Root).Bin
    if (($env:Path -split ';') -notcontains $bin) { $env:Path = $bin + ';' + $env:Path }
}

# postgrest.exe needs libpq.dll from the PostgreSQL binaries on PATH.
function Install-Postgrest([string]$Root) {
    $layout = Get-DatabaseLayout $Root
    Add-PostgresToPath $Root
    if (Test-Path -LiteralPath $layout.PostgrestExe) {
        $installed = ((& $layout.PostgrestExe --version) -join ' ') -replace '^PostgREST\s+([0-9.]+).*$', '$1'
        if ($installed -eq $script:PostgrestVersion) { return }
        throw "PostgREST $installed is installed; expected $script:PostgrestVersion. Upgrade it deliberately."
    }
    $asset = "postgrest-v$script:PostgrestVersion-windows-x86-64.zip"
    $release = Invoke-RestMethod -Headers @{ 'User-Agent' = 'yanlearn' } -Uri ('https://api.github.com/repos/{0}/releases/tags/v{1}' -f $script:PostgrestRepository, $script:PostgrestVersion)
    $entry = $release.assets | Where-Object { $_.name -eq $asset } | Select-Object -First 1
    if (-not $entry -or [string]$entry.digest -notmatch '^sha256:([0-9a-f]{64})$') { throw "GitHub lists no SHA-256 for $asset." }
    $expected = $Matches[1]
    $work = Join-Path $Root ('downloads\postgrest-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    try {
        $zip = Join-Path $work $asset
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $entry.browser_download_url -OutFile $zip
        if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $expected) { throw "$asset does not match GitHub's SHA-256." }
        Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $work 'unpacked')
        $exe = Get-ChildItem -LiteralPath (Join-Path $work 'unpacked') -Filter 'postgrest.exe' -Recurse | Select-Object -First 1
        if (-not $exe) { throw "$asset contains no postgrest.exe." }
        New-Item -ItemType Directory -Path (Split-Path -Parent $layout.PostgrestExe) -Force | Out-Null
        Move-Item -LiteralPath $exe.FullName -Destination $layout.PostgrestExe
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Use-LocalDatabase([string]$Root, [string]$User = 'postgres', [string]$Database = 'postgres') {
    $settings = Read-Json (Get-DatabaseLayout $Root).Settings
    if (-not $settings) { throw 'Run install-database.ps1 first.' }
    $password = switch ($User) {
        'postgres' { $settings.SuperuserPassword }
        'yanlearn_backup' { $settings.BackupPassword }
        default { throw "No stored password for $User." }
    }
    $env:PGHOST = '127.0.0.1'
    $env:PGPORT = [string]$script:PostgresPort
    $env:PGUSER = $User
    $env:PGDATABASE = $Database
    $env:PGPASSWORD = $password
    $env:PGSSLMODE = 'disable'
    Remove-Item Env:PGSSLROOTCERT -ErrorAction SilentlyContinue
    $env:PGAPPNAME = 'yanlearn-ops'
    $env:PGCONNECT_TIMEOUT = '10'
}

# Runs SQL from a temporary file: piping it to psql would go through
# PowerShell 5.1's ASCII stdin encoding.
function Invoke-Sql([string]$Root, [string]$Sql, [string[]]$Arguments = @()) {
    $layout = Get-DatabaseLayout $Root
    $work = Join-Path $Root 'postgres\work'
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    $file = Join-Path $work ('sql-' + [Guid]::NewGuid().ToString('N') + '.sql')
    [IO.File]::WriteAllText($file, $Sql, (New-Object Text.UTF8Encoding $false))
    try { return Invoke-PgTool $layout.Bin 'psql' (@('-X', '-v', 'ON_ERROR_STOP=1', '-f', $file) + $Arguments) }
    finally { Remove-Item -LiteralPath $file -ErrorAction SilentlyContinue }
}

# Supabase's auth.uid()/auth.role(), which legacy policies call. service_role
# bypasses RLS, so they never decide anything for the app.
$script:SupabaseCompatibilitySql = @'
create schema if not exists extensions;
grant usage on schema extensions to public;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists auth;
grant usage on schema auth to public;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
'@

# Every request arrives as service_role (BYPASSRLS), which gets everything in
# public; anon and authenticated get nothing. Unlike on Supabase, PUBLIC cannot
# execute functions, which closes execute_sql-style holes.
$script:PrivilegesSql = @'
revoke all on schema public from public;
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
revoke execute on all functions in schema public from public;
grant execute on all functions in schema public to service_role;
alter default privileges for role yanlearn_owner revoke execute on functions from public;
alter default privileges for role yanlearn_owner in schema public grant all on tables to service_role;
alter default privileges for role yanlearn_owner in schema public grant all on sequences to service_role;
alter default privileges for role yanlearn_owner in schema public grant execute on functions to service_role;
'@

# A new, empty yanlearn database. -ForRestore drops public, which the dump
# recreates as yanlearn_owner (pg_restore --role).
function New-YanLearnDatabase([string]$Root, [switch]$ForRestore) {
    Use-LocalDatabase $Root 'postgres' 'postgres'
    Invoke-Sql $Root "drop database if exists yanlearn with (force);`ncreate database yanlearn owner yanlearn_owner;" | Out-Null
    $env:PGDATABASE = 'yanlearn'
    $tail = if ($ForRestore) { 'drop schema public;' } else { "alter schema public owner to yanlearn_owner;`n" + $script:PrivilegesSql }
    Invoke-Sql $Root ($script:SupabaseCompatibilitySql + "`n" + $tail) | Out-Null
}

function Register-PostgrestTask([string]$Root) {
    $launcher = Join-Path $Root 'ops\postgrest.ps1'
    $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Root "{1}"' -f $launcher, $Root
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments
    $triggers = @(
        (New-ScheduledTaskTrigger -AtStartup),
        (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1))
    )
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $script:PostgrestTaskName -Action $action -Trigger $triggers -Settings $settings `
        -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
}

function Test-PostgrestReady([int]$Seconds = 30) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try {
            $null = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:{0}/ready' -f $script:PostgrestAdminPort) -TimeoutSec 3
            return $true
        } catch { Start-Sleep -Seconds 1 }
    } while ((Get-Date) -lt $deadline)
    return $false
}

# The supervisor restarts postgrest.exe within seconds; the restart also
# reloads its schema cache after a restore.
function Restart-Postgrest {
    Get-Process -Name postgrest -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 1
    if (-not (Test-PostgrestReady 60)) { throw 'PostgREST did not come back after a restart.' }
}
