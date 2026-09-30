[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn', [string]$Ref = 'origin/master', [switch]$PrepareOnly)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Administrator
$lock = $null
$next = $null
$activated = $false
try {
    try { $lock = [IO.File]::Open((Join-Path $Root 'deploy.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'Another YanLearn deployment is running.' }
    $config = Read-Json (Join-Path $Root 'server.json')
    if (-not $config) { throw 'Run install.ps1 first.' }
    Import-ProductionEnvironment $Root
    $repo = Join-Path $Root 'repo'
    $log = Join-Path $Root 'logs\deploy.log'
    $gitOptions = @('-c', ('safe.directory=' + ($repo -replace '\\','/')), '-C', $repo)
    Invoke-Tool $config.git ($gitOptions + @('fetch','origin','master')) $log
    $commit = (& $config.git @gitOptions rev-parse --verify ($Ref + '^{commit}')).Trim()
    if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') { throw 'Cannot resolve the requested revision.' }
    $active = Read-Json (Join-Path $Root 'active.json')
    if ($active -and $active.commit -eq $commit -and (Test-Release $active 5)) { Write-Output "Already serving $commit"; exit 0 }
    $port = if ($active -and $active.port -eq 3100) { 3101 } else { 3100 }
    if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "Staging port $port is occupied; inspect status before deploying." }
    Invoke-Tool $config.git ($gitOptions + @('checkout','--detach',$commit)) $log
    $env:YANLEARN_COMMIT_SHA = $commit
    # Keep build tools in npm ci even though the eventual server is production.
    $env:NODE_ENV = 'development'
    Set-Location $repo
    Invoke-Tool $config.npm @('ci','--include=dev','--allow-remote=all','--no-audit','--no-fund') $log
    $env:NODE_ENV = 'production'
    Invoke-Tool $config.npm @('run','build') $log
    $releaseId = $commit.Substring(0,12) + '-' + (Get-Date -Format 'yyyyMMddHHmmss')
    $release = Join-Path $Root ('releases\' + $releaseId)
    $app = Join-Path $release 'app'
    New-Item -ItemType Directory -Path $app,(Join-Path $release 'ops') -Force | Out-Null
    Copy-Item -Path (Join-Path $repo '.next\standalone\*') -Destination $app -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $repo 'public') -Destination (Join-Path $app 'public') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $repo '.next\static') -Destination (Join-Path $app '.next\static') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $repo 'assets') -Destination (Join-Path $app 'assets') -Recurse -Force
    Copy-Item -Path (Join-Path $repo 'deploy\windows\*.ps1') -Destination (Join-Path $release 'ops') -Force
    # Retain old immutable chunks for browsers still open across a deployment.
    Copy-Item -Path (Join-Path $repo '.next\static\*') -Destination (Join-Path $Root 'static') -Recurse -Force
    $next = [pscustomobject]@{ commit=$commit; release=$release; port=$port; taskName=('yanlearn-web-' + $releaseId); createdAt=(Get-Date).ToUniversalTime().ToString('o') }
    Write-Json (Join-Path $release 'release.json') $next
    Register-WebTask $Root $next
    if (-not (Test-Release $next)) { throw 'The new release failed its readiness probe. Existing traffic is unchanged.' }
    # Exercise database-backed reads before allowing the new process to take traffic.
    $null = Invoke-RestMethod -Uri ("http://127.0.0.1:$port/api/team/count") -TimeoutSec 20
    if ($PrepareOnly) {
        Write-Json (Join-Path $Root 'prepared.json') $next
        $activated = $true
        Write-Output "Prepared $commit on loopback port $port; public traffic is unchanged."
        exit 0
    }
    Switch-Caddy $Root $config $port
    # Traffic already reaches this process. A later metadata/logging failure
    # must not make the finally block kill the server Caddy is now using.
    $activated = $true
    if ($active) { Write-Json (Join-Path $Root 'previous.json') $active }
    Write-Json (Join-Path $Root 'active.json') $next
    Copy-Item -Path (Join-Path $repo 'deploy\windows\*.ps1') -Destination (Join-Path $Root 'ops') -Force
    # The reminders tick can take several minutes; retain the previous process
    # long enough for in-flight cron work and recording streams to finish.
    if ($active) { Start-Sleep -Seconds 300; Stop-WebTask $Root $active }
    Write-Output "Serving $commit on port $port."
} finally {
    if ($next -and -not $activated) { Stop-WebTask $Root $next }
    if ($lock) { $lock.Dispose() }
}
