[CmdletBinding()]
param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Release,
    [Parameter(Mandatory)][int]$Port, [Parameter(Mandatory)][string]$Commit)
. (Join-Path $PSScriptRoot 'common.ps1')
$Release = Assert-UnderRoot $Release (Join-Path $Root 'releases')
$config = Read-Json (Join-Path $Root 'server.json')
Import-ProductionEnvironment $Root
$env:PORT = [string]$Port
$env:HOSTNAME = '127.0.0.1'
$env:YANLEARN_COMMIT_SHA = $Commit
$env:YANLEARN_ZEN_GATEWAY_PORT = '3102'
# Bootstrap on the first deployment even when the previous deploy.ps1 has no
# knowledge of the worker. Its supervisor always reads active.json, not staging.
try { Register-ZenGatewayTask $Root (Join-Path $PSScriptRoot 'zen-gateway.ps1') }
catch { Add-Content -LiteralPath (Join-Path $Root 'logs\zen-gateway.log') -Value ('Worker setup failed: ' + $_.Exception.Message) }
$server = Join-Path $Release 'app\server.js'
$log = Join-Path $Root ('logs\web-' + $Port + '.log')
Set-Location (Join-Path $Release 'app')
while ($true) {
    try { Invoke-Tool $config.node @($server) $log } catch { Add-Content -LiteralPath $log -Value $_.Exception.Message }
    Start-Sleep -Seconds 3
}
