# Backups of the self-hosted database, every 6 hours (task yanlearn-db-backup):
# pg_dump into backups\db, kept 14 days, and an AES-256-GCM copy in the
# recordings bucket under db-backups/, kept 60 days. Emails the founder when a
# run fails or no backup has succeeded for 26 hours (at most every 12 hours).
#   -Register    (re)create the scheduled task
#   -File <path> encrypt an existing dump into db-backups/archive/ (never pruned)
#   -Drill       afterwards download the newest copy, decrypt it, restore it
#                into a scratch database and compare row counts
[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn', [switch]$Register, [string]$File, [switch]$Drill)
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'database.ps1')
Assert-Administrator
$layout = Get-DatabaseLayout $Root

if ($Register) {
    $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Root "{1}"' -f (Join-Path $Root 'ops\backup-db.ps1'), $Root
    $trigger = New-ScheduledTaskTrigger -Once -At ([DateTime]::Today.AddHours(3).AddMinutes(30)) -RepetitionInterval (New-TimeSpan -Hours 6)
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
        -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName 'yanlearn-db-backup' -Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments) `
        -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
    Write-Output 'Registered yanlearn-db-backup: every 6 hours from 03:30.'
    return
}

try { $backupLock = [IO.File]::Open((Join-Path $Root 'db-backup.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch [IO.IOException] { throw 'Another database backup is running.' }
$statusPath = Join-Path $Root 'db-backup-status.json'
$status = Read-Json $statusPath
if (-not $status) { $status = [pscustomobject]@{} }
function Set-Status([string]$Name, $Value) { $status | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force }
$production = Read-Json (Join-Path $Root 'secrets\production.json')

function Send-Alert([string]$Subject, [string]$Body) {
    $last = if ($status.PSObject.Properties['lastAlertAt'] -and $status.lastAlertAt) { [DateTime]$status.lastAlertAt } else { [DateTime]::MinValue }
    if (((Get-Date).ToUniversalTime() - $last.ToUniversalTime()).TotalHours -lt 12) { return }
    $message = @{ from = $production.RESEND_FROM; to = @($production.NEXT_PUBLIC_FOUNDER_EMAIL); subject = $Subject; text = $Body } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri 'https://api.resend.com/emails' -Headers @{ Authorization = 'Bearer ' + $production.RESEND_API_KEY } `
        -ContentType 'application/json' -Body $message -TimeoutSec 20 | Out-Null
    Set-Status 'lastAlertAt' (Get-Date).ToUniversalTime().ToString('o')
}

# The bundled tool from the active release, with the recordings bucket's
# settings and the passphrase set for that process only.
function Invoke-BackupTool([string[]]$Arguments) {
    $active = Read-Json (Join-Path $Root 'active.json')
    $tool = Join-Path $active.release 'app\db-backup.cjs'
    if (-not (Test-Path -LiteralPath $tool)) { throw 'The active release predates db-backup.cjs.' }
    $passphraseFile = Join-Path $Root 'secrets\db-backup-passphrase.dpapi'
    if (-not (Test-Path -LiteralPath $passphraseFile)) { throw 'Run set-backup-passphrase.ps1 first.' }
    $names = 'RECORDINGS_S3_ENDPOINT', 'RECORDINGS_S3_REGION', 'RECORDINGS_S3_ACCESS_KEY_ID', 'RECORDINGS_S3_SECRET_ACCESS_KEY', 'RECORDINGS_S3_BUCKET'
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, [string]$production.$name) }
    $env:DB_BACKUP_PASSPHRASE = Unprotect-MachineSecret $passphraseFile
    $node = (Read-Json (Join-Path $Root 'server.json')).node
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& $node $tool @Arguments 2>&1 | ForEach-Object { "$_" })
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $oldPreference
        Remove-Item Env:DB_BACKUP_PASSPHRASE -ErrorAction SilentlyContinue
        foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $null) }
    }
    if ($code -ne 0) { throw ("db-backup {0} failed: {1}" -f $Arguments[0], ($output -join ' ')) }
    return $output
}

$folder = Join-Path $layout.Backups 'db'
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$started = (Get-Date).ToUniversalTime()
Set-Status 'lastAttemptAt' $started.ToString('o')
try {
    if ($File) {
        $result = Invoke-BackupTool @('upload', $File, ('archive/' + (Split-Path -Leaf $File))) | Select-Object -Last 1 | ConvertFrom-Json
        Write-Output "Archived $(Split-Path -Leaf $File) as $($result.key) ($($result.bytes) bytes)."
        return
    }
    $dump = Join-Path $folder ('yanlearn-{0}Z.dump' -f $started.ToString('yyyyMMdd-HHmmss'))
    try { Use-LocalDatabase $Root 'yanlearn_backup' 'yanlearn'; Invoke-PgTool $layout.Bin 'pg_dump' @('--format=custom', "--file=$dump") | Out-Null }
    finally { Clear-PgEnvironment }
    Get-ChildItem -LiteralPath $folder -Filter 'yanlearn-*.dump' | Where-Object { $_.LastWriteTimeUtc -lt $started.AddDays(-14) } | Remove-Item -Force
    $result = Invoke-BackupTool @('upload', $dump, (Split-Path -Leaf $dump)) | Select-Object -Last 1 | ConvertFrom-Json
    Set-Status 'lastSuccessAt' (Get-Date).ToUniversalTime().ToString('o')
    Set-Status 'lastDump' (Split-Path -Leaf $dump)
    Set-Status 'lastDumpBytes' (Get-Item -LiteralPath $dump).Length
    Set-Status 'lastOffsiteKey' $result.key
    Set-Status 'lastOffsitePruned' $result.pruned
    Set-Status 'lastError' $null
    Write-Output ("Backed up {0} ({1} bytes); offsite copy {2}, {3} old copies pruned." -f (Split-Path -Leaf $dump), (Get-Item -LiteralPath $dump).Length, $result.key, $result.pruned)

    if ($Drill) {
        $latest = (Invoke-BackupTool @('latest') | Select-Object -Last 1).Trim()
        $restored = Join-Path $folder 'drill.dump'
        Invoke-BackupTool @('download', $latest, $restored) | Out-Null
        try {
            Use-LocalDatabase $Root 'postgres' 'postgres'
            Invoke-Sql $Root "drop database if exists yanlearn_drill with (force);`ncreate database yanlearn_drill owner yanlearn_owner;" | Out-Null
            $env:PGDATABASE = 'yanlearn_drill'
            Invoke-PgTool $layout.Bin 'pg_restore' @('--dbname=yanlearn_drill', '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction', $restored) | Out-Null
            # Exact row counts of every public table, in both databases.
            $countSql = "select string_agg(format('%s=%s', c.relname, (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]), ',' order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r';"
            $drillCounts = (Invoke-Sql $Root $countSql @('-A', '-t')) -join ''
            $env:PGDATABASE = 'yanlearn'
            $liveCounts = (Invoke-Sql $Root $countSql @('-A', '-t')) -join ''
            $env:PGDATABASE = 'postgres'
            Invoke-Sql $Root 'drop database yanlearn_drill with (force);' | Out-Null
        } finally {
            Clear-PgEnvironment
            Remove-Item -LiteralPath $restored -Force -ErrorAction SilentlyContinue
        }
        $tables = @($drillCounts -split ',' | Where-Object { $_ }).Count
        if (-not $tables -or $tables -ne @($liveCounts -split ',' | Where-Object { $_ }).Count) {
            throw "The drill restored $tables tables; the live database has a different set."
        }
        # Writes after the dump move live counts on, so only the table set must match.
        Write-Output ("Drill: downloaded {0}, decrypted, restored {1} tables; counts {2} the live database." -f $latest, $tables, $(if ($drillCounts -eq $liveCounts) { 'match' } else { 'differ slightly from' }))
        Set-Status 'lastDrillAt' (Get-Date).ToUniversalTime().ToString('o')
        Set-Status 'lastDrillTables' $tables
    }
} catch {
    Set-Status 'lastError' $_.Exception.Message
    try { Send-Alert 'YanLearn database backup failed' ("The database backup on finprint-host failed at {0:u} UTC:`n`n{1}`n`nCheck C:\ProgramData\YanLearn\db-backup-status.json." -f (Get-Date).ToUniversalTime(), $_.Exception.Message) } catch {}
    throw
} finally {
    $lastSuccess = if ($status.PSObject.Properties['lastSuccessAt'] -and $status.lastSuccessAt) { [DateTime]$status.lastSuccessAt } else { $null }
    if ($lastSuccess -and ((Get-Date).ToUniversalTime() - $lastSuccess.ToUniversalTime()).TotalHours -gt 26) {
        try { Send-Alert 'YanLearn has no recent database backup' ("No database backup has succeeded on finprint-host since {0:u} UTC." -f $lastSuccess.ToUniversalTime()) } catch {}
    }
    Write-Json $statusPath $status
    $backupLock.Dispose()
}
