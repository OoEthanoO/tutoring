[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn', [switch]$ActivatePrepared)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Administrator
$lock = [IO.File]::Open((Join-Path $Root 'deploy.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
try {
    $config = Read-Json (Join-Path $Root 'server.json')
    $old = Read-Json (Join-Path $Root 'active.json')
    $target = Read-Json (Join-Path $Root $(if ($ActivatePrepared) { 'prepared.json' } else { 'previous.json' }))
    if (-not $target) { throw 'No saved release to activate.' }
    $null = Assert-UnderRoot $target.release (Join-Path $Root 'releases')
    if (-not (Test-Release $target 5)) { Register-WebTask $Root $target }
    if (-not (Test-Release $target)) { throw 'Saved release is not healthy; traffic is unchanged.' }
    Switch-Caddy $Root $config $target.port
    if ($old -and $old.commit -ne $target.commit) { Write-Json (Join-Path $Root 'previous.json') $old }
    Write-Json (Join-Path $Root 'active.json') $target
    if ($old -and $old.taskName -ne $target.taskName) { Start-Sleep -Seconds 300; Stop-WebTask $Root $old }
    Write-Output ('Activated ' + $target.commit)
} finally { $lock.Dispose() }
