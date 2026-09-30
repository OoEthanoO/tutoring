[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn')
. (Join-Path $PSScriptRoot 'common.ps1')
$lock = $null
$started = (Get-Date).ToUniversalTime()
$statusPath = Join-Path $Root 'reminders-status.json'
try {
    # Also excludes manual invocations and protects a release from retirement
    # while its reminders request is still running.
    try { $lock = [IO.File]::Open((Join-Path $Root 'reminders.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch [IO.IOException] { return }
    $active = Read-Json (Join-Path $Root 'active.json')
    if (-not $active) { return }
    $port = [int]$active.port
    if ($port -lt 1024 -or $port -gt 65535) { throw 'Invalid active release port.' }
    $config = Read-Json (Join-Path $Root 'secrets\production.json')
    if (-not $config.CRON_SECRET) { throw 'Missing CRON_SECRET.' }
    Write-Json $statusPath @{status='running'; startedAt=$started.ToString('o'); commit=$active.commit}
    # A client timeout cannot cancel server-side work. Wait for completion so
    # the next minute cannot launch a duplicate while this one still runs.
    $result = Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:{0}/api/cron/class-reminders' -f $port) `
        -Headers @{Authorization=('Bearer ' + $config.CRON_SECRET)} -TimeoutSec 0
    # Keep only counters; response bodies can include student data.
    $status = @{
        status='completed'; startedAt=$started.ToString('o'); completedAt=(Get-Date).ToUniversalTime().ToString('o')
        seconds=[math]::Round(((Get-Date).ToUniversalTime() - $started).TotalSeconds, 1); commit=$active.commit
        sentClassCount=[int]$result.sentClassCount; sentEmailCount=[int]$result.sentEmailCount
        sentDiscordReminderCount=[int]$result.sentDiscordReminderCount
        discordSyncErrorCount=@($result.discordSync.errors | Where-Object { $_ }).Count
        liveChannelCleanupErrorCount=@($result.liveChannelCleanupErrors | Where-Object { $_ }).Count
    }
    Write-Json $statusPath $status
    $log = Join-Path $Root 'logs\reminders.log'
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5MB) {
        Move-Item -LiteralPath $log -Destination ($log + '.previous') -Force
    }
    Add-Content -LiteralPath $log -Value ($status | ConvertTo-Json -Compress)
} catch {
    # Do not log exception bodies or request headers, which may expose secrets.
    Write-Json $statusPath @{status='failed'; startedAt=$started.ToString('o'); completedAt=(Get-Date).ToUniversalTime().ToString('o'); errorType=$_.Exception.GetType().Name}
    exit 1
} finally {
    if ($lock) { $lock.Dispose() }
}
