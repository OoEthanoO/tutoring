# Moves the live site from hosted Supabase to the self-hosted database inside
# a short write freeze (rehearse first with db-restore.ps1 -Mode Trial):
#   1. freeze: hold deploy.lock, pause deployments and reminders, stop the Zen
#      gateway, answer 503 for learn.ethanyanxu.com, stop the web release;
#   2. wait until Supabase has seen no writes for 60 seconds;
#   3. final copy: db-restore.ps1 -Mode Cutover, where every table must match;
#   4. switch: production.json gets the local gateway and service key (the
#      Supabase values stay in production.supabase.json) and the same release
#      restarts with them; it must pass health, database and middleware checks;
#   5. unfreeze: normal Caddy, one reminders tick, Zen gateway, tasks back on,
#      and a snapshot of the new database.
# A failure before the switch resumes service on Supabase, which was never
# written to; a failure at the switch switches back. -Rollback returns a
# finished cutover to Supabase (writes made since then stay local only).
[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn', [switch]$Rollback)
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'database.ps1')
Assert-Administrator
$layout = Get-DatabaseLayout $Root
$config = Read-Json (Join-Path $Root 'server.json')
$active = Read-Json (Join-Path $Root 'active.json')
$settings = Read-Json $layout.Settings
$productionPath = Join-Path $Root 'secrets\production.json'
$supabaseCopyPath = Join-Path $Root 'secrets\production.supabase.json'
$localUrl = 'http://127.0.0.1:{0}' -f $script:DatabaseGatewayPort
$log = Join-Path $Root 'logs\db-cutover.log'
$utf8 = New-Object Text.UTF8Encoding $false

function Write-Step([string]$Message) {
    $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $Message
    Write-Output $line
    Add-Content -LiteralPath $log -Value $line
}

function Set-DatabaseSettings([string]$Url, [string]$Key) {
    $values = Read-Json $productionPath
    $values.SUPABASE_URL = $Url
    $values.SUPABASE_SERVICE_ROLE_KEY = $Key
    Write-Json $productionPath $values
}

# Restarts the active release so it reads production.json again, then checks
# health, a database read and a page through middleware.
function Restart-ActiveRelease {
    Stop-WebTask $Root $active
    Register-WebTask $Root $active
    if (-not (Test-Release $active 90)) { throw 'The web release did not become healthy.' }
    if (-not (Test-ReleaseDatabase $active)) { throw 'The web release cannot read its database.' }
    $letter = Invoke-WebRequest -UseBasicParsing -Method Head -TimeoutSec 20 `
        -Uri ('http://127.0.0.1:{0}/Letter%20of%20Support%20from%20SickKids%20Foundation.pdf' -f $active.port)
    if ($letter.StatusCode -ne 200) { throw 'Pages do not load through middleware.' }
}

function Set-MaintenanceCaddy {
    # Switch-Caddy's site answering 503 instead of proxying; the database
    # gateway stays for the final checks.
    $sitePath = Join-Path $Root 'Caddyfile'
    $oldSite = [IO.File]::ReadAllText($sitePath)
    $site = @"
learn.ethanyanxu.com {
    header X-YanLearn-Host finprint-host
    header Retry-After 600
    respond "YanLearn is moving to its new database and will be back in a few minutes." 503
}

http://127.0.0.1:$script:DatabaseGatewayPort {
    bind 127.0.0.1
    handle_path /rest/v1/* {
        reverse_proxy 127.0.0.1:$script:PostgrestPort
    }
    handle {
        respond 404
    }
}
"@
    $caddyLog = Join-Path $Root 'logs\caddy-reload.log'
    try {
        [IO.File]::WriteAllText($sitePath, $site, $utf8)
        Invoke-Tool $config.caddy @('validate', '--config', $config.mainCaddyfile, '--adapter', 'caddyfile') $caddyLog
        Invoke-Tool $config.caddy @('reload', '--config', $config.mainCaddyfile, '--adapter', 'caddyfile') $caddyLog
    } catch {
        [IO.File]::WriteAllText($sitePath, $oldSite, $utf8)
        try { Invoke-Tool $config.caddy @('reload', '--config', $config.mainCaddyfile, '--adapter', 'caddyfile') $caddyLog } catch {}
        throw
    }
}

function Wait-Until([scriptblock]$Condition, [int]$Seconds, [string]$Failure) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while (-not (& $Condition)) {
        if ((Get-Date) -gt $deadline) { throw $Failure }
        Start-Sleep -Seconds 2
    }
}

function Test-FileFree([string]$Path) {
    try { ([IO.File]::Open($Path, 'OpenOrCreate', 'ReadWrite', 'None')).Dispose(); return $true }
    catch [IO.IOException] { return $false }
}

function Get-SupabaseWrites {
    try {
        Use-SupabaseSource $Root
        $sql = "select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) from pg_stat_user_tables where schemaname = 'public';"
        return ((Invoke-Sql $Root $sql @('-A', '-t')) -join '').Trim()
    } finally { Clear-PgEnvironment }
}

$tasks = @{}
function Suspend-Task([string]$Name) {
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    $tasks[$Name] = [bool]($task -and $task.State -ne 'Disabled')
    if ($task) { Disable-ScheduledTask -TaskName $Name | Out-Null }
}
function Resume-Tasks {
    foreach ($name in $tasks.Keys) {
        if ($tasks[$name]) { Enable-ScheduledTask -TaskName $name | Out-Null }
    }
    if ($tasks['yanlearn-zen-gateway']) { Start-ScheduledTask -TaskName 'yanlearn-zen-gateway' }
}

if ($Rollback) {
    $supabase = Read-Json $supabaseCopyPath
    if (-not $supabase) { throw 'No production.supabase.json: there is no cutover to roll back.' }
    Write-Step 'Rollback: pointing production.json back at Supabase. Writes made to the local database since the cutover are not on Supabase.'
    Set-DatabaseSettings $supabase.SUPABASE_URL $supabase.SUPABASE_SERVICE_ROLE_KEY
    Restart-ActiveRelease
    Write-Step 'Rollback done: the site reads and writes Supabase again.'
    return
}

$deployLock = $null
$phase = 'checks'
$supabase = $null
try {
    if (([Uri][string](Read-Json $productionPath).SUPABASE_URL).Host -eq '127.0.0.1') { throw 'production.json already points at the local database.' }
    if (-not $active -or -not (Test-Release $active 5)) { throw 'The active release is not healthy; fix that first.' }
    if ((Get-Service -Name $script:PostgresServiceName).Status -ne 'Running' -or -not (Test-PostgrestReady 5)) { throw 'The local database is not running.' }
    Write-Step "Cutover starting; active release $($active.commit.Substring(0, 7)) on port $($active.port)."

    $phase = 'freeze'
    Suspend-Task 'yanlearn-deploy'
    $lockPath = Join-Path $Root 'deploy.lock'
    Wait-Until { try { $script:deployLock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None'); $true } catch [IO.IOException] { $false } } 600 'A deployment held deploy.lock for 10 minutes.'
    $deployLock = $script:deployLock
    Suspend-Task 'yanlearn-reminders'
    Wait-Until { Test-FileFree (Join-Path $Root 'reminders.lock') } 300 'A reminders run was still going after 5 minutes.'
    Suspend-Task 'yanlearn-zen-gateway'
    Stop-ScheduledTask -TaskName 'yanlearn-zen-gateway' -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('zen-gateway.cjs') } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Wait-Until { -not (Get-NetTCPConnection -State Listen -LocalPort 3102 -ErrorAction SilentlyContinue) } 20 'The Zen gateway kept listening on 3102.'
    Write-Step 'Deployments, reminders and the Zen gateway are paused.'
    Set-MaintenanceCaddy
    Write-Step 'learn.ethanyanxu.com now answers 503; letting in-flight requests finish.'
    Start-Sleep -Seconds 15
    Stop-WebTask $Root $active
    Wait-Until { -not (Get-NetTCPConnection -State Listen -LocalPort $active.port -ErrorAction SilentlyContinue) } 30 'The web release kept listening.'
    Write-Step 'The web release is stopped; nothing on this server writes to Supabase.'

    $phase = 'quiet'
    $last = Get-SupabaseWrites
    $quietSince = Get-Date
    $deadline = (Get-Date).AddMinutes(5)
    while (((Get-Date) - $quietSince).TotalSeconds -lt 60) {
        if ((Get-Date) -gt $deadline) { throw 'Supabase kept receiving writes for 5 minutes after the freeze; something else writes to it.' }
        Start-Sleep -Seconds 10
        $now = Get-SupabaseWrites
        if ($now -ne $last) { Write-Step 'Supabase is still settling; waiting.'; $last = $now; $quietSince = Get-Date }
    }
    Write-Step 'Supabase has seen no writes for 60 seconds.'

    $phase = 'copy'
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'db-restore.ps1') -Root $Root -Mode Cutover 2>&1 |
        ForEach-Object { Write-Step ('  ' + $_) }
    $copyCode = $LASTEXITCODE
    $ErrorActionPreference = $oldPreference
    if ($copyCode -ne 0) { throw 'The final copy did not pass its checks.' }
    Write-Step 'Final copy matches Supabase exactly.'

    $phase = 'switch'
    if (-not (Test-Path -LiteralPath $supabaseCopyPath)) { Copy-Item -LiteralPath $productionPath -Destination $supabaseCopyPath }
    $supabase = Read-Json $supabaseCopyPath
    Set-DatabaseSettings $localUrl $settings.ServiceRoleKey
    Write-Step 'production.json now points at the local database; restarting the web release.'
    Restart-ActiveRelease
    Switch-Caddy $Root $config $active.port
    Write-Step 'The site is back, served from the local database.'

    $phase = 'live'
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $Root 'ops\reminders.ps1') -Root $Root
    $tick = Read-Json (Join-Path $Root 'reminders-status.json')
    Write-Step ("Reminders tick: {0}, {1} s, Discord sync errors {2}, live channel errors {3}." -f $tick.status, $tick.seconds, $tick.discordSyncErrorCount, $tick.liveChannelCleanupErrorCount)
    Resume-Tasks
    $tasks.Clear()
    $snapshot = Join-Path $layout.Backups ('db\yanlearn-{0}Z-cutover.dump' -f (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path (Split-Path -Parent $snapshot) -Force | Out-Null
    try { Use-LocalDatabase $Root 'yanlearn_backup' 'yanlearn'; Invoke-PgTool $layout.Bin 'pg_dump' @('--format=custom', "--file=$snapshot") | Out-Null }
    finally { Clear-PgEnvironment }
    Write-Step ('Snapshot of the new database: ' + (Split-Path -Leaf $snapshot))
    Write-Step 'Cutover complete.'
} catch {
    $failure = $_.Exception.Message
    Write-Step "FAILED during ${phase}: $failure"
    try {
        if ($phase -in 'freeze', 'quiet', 'copy') {
            Write-Step 'Resuming service on Supabase, which was not written to.'
            Register-WebTask $Root $active
            if (-not (Test-Release $active 90)) { throw 'the web release did not come back' }
            Switch-Caddy $Root $config $active.port
            Resume-Tasks
            Write-Step 'Service resumed on Supabase.'
        } elseif ($phase -eq 'switch' -and $supabase) {
            Write-Step 'Switching back to Supabase.'
            Set-DatabaseSettings $supabase.SUPABASE_URL $supabase.SUPABASE_SERVICE_ROLE_KEY
            Restart-ActiveRelease
            Switch-Caddy $Root $config $active.port
            Resume-Tasks
            Write-Step 'Service resumed on Supabase.'
        }
    } catch {
        Write-Step "RECOVERY FAILED: $($_.Exception.Message). The site may be down; see logs\db-cutover.log."
    }
    throw "Cutover failed during ${phase}: $failure"
} finally {
    if ($deployLock) { $deployLock.Dispose() }
}
