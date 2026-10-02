[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn')
. (Join-Path $PSScriptRoot 'common.ps1')
# A single supervisor survives web-process restarts and overlapping deployments.
try { $workerLock = [IO.File]::Open((Join-Path $Root 'zen-gateway.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch [IO.IOException] { exit 0 }
try {
    $config = Read-Json (Join-Path $Root 'server.json')
    $log = Join-Path $Root 'logs\zen-gateway.log'
    while ($true) {
        try {
            $active = Read-Json (Join-Path $Root 'active.json')
            if ($active) {
                $release = Assert-UnderRoot $active.release (Join-Path $Root 'releases')
                $script = Join-Path $release 'app\zen-gateway.cjs'
                # Rolling back to a release without the listener keeps the
                # minute-by-minute fallback, without running stale worker code.
                if (Test-Path -LiteralPath $script) {
                    Import-ProductionEnvironment $Root
                    $env:YANLEARN_RUNTIME_ROOT = $Root
                    $env:YANLEARN_COMMIT_SHA = $active.commit
                    $env:YANLEARN_ZEN_GATEWAY_PORT = '3102'
                    Set-Location (Join-Path $release 'app')
                    Invoke-Tool $config.node @($script) $log
                }
            }
        } catch { Add-Content -LiteralPath $log -Value ((Get-Date).ToString('o') + ' ' + $_.Exception.Message) }
        Start-Sleep -Seconds 3
    }
} finally { $workerLock.Dispose() }
