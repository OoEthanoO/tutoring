[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn')
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'database.ps1')
# One supervisor keeps PostgREST running; Task Scheduler starts it at boot and
# every minute, and the lock turns every extra start into a no-op.
try { $supervisorLock = [IO.File]::Open((Join-Path $Root 'postgrest.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch [IO.IOException] { exit 0 }
try {
    $layout = Get-DatabaseLayout $Root
    $log = Join-Path $Root 'logs\postgrest.log'
    $status = Join-Path $Root 'postgrest-status.json'
    Add-PostgresToPath $Root
    $restarts = 0
    while ($true) {
        if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5MB) {
            Move-Item -LiteralPath $log -Destination ($log + '.previous') -Force
        }
        Write-Json $status ([ordered]@{ state = 'running'; since = (Get-Date).ToUniversalTime().ToString('o'); restarts = $restarts })
        try { Invoke-Tool $layout.PostgrestExe @($layout.PostgrestConfig) $log }
        catch { Add-Content -LiteralPath $log -Value ('{0:o} supervisor: {1}' -f (Get-Date), $_.Exception.Message) }
        $restarts++
        Write-Json $status ([ordered]@{ state = 'restarting'; since = (Get-Date).ToUniversalTime().ToString('o'); restarts = $restarts })
        Start-Sleep -Seconds 3
    }
} finally {
    $supervisorLock.Dispose()
}
