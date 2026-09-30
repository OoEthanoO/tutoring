[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script = Join-Path $Root 'ops\deploy.ps1'
$log = Join-Path $Root 'logs\poller.log'
try {
    & $script -Root $Root >> $log 2>&1
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} catch {
    Add-Content -LiteralPath $log -Value ((Get-Date).ToString('o') + ' ' + $_.Exception.Message)
    exit 1
}
