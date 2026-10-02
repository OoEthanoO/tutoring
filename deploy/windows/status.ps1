[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn')
. (Join-Path $PSScriptRoot 'common.ps1')
$active = Read-Json (Join-Path $Root 'active.json')
$prepared = Read-Json (Join-Path $Root 'prepared.json')
$previous = Read-Json (Join-Path $Root 'previous.json')
[pscustomobject]@{active=$active;prepared=$prepared;previous=$previous} | ConvertTo-Json -Depth 5
Get-ScheduledTask -TaskName 'yanlearn-*' -ErrorAction SilentlyContinue | Select-Object TaskName,State | Format-Table
$reminders = Read-Json (Join-Path $Root 'reminders-status.json')
if ($reminders) { $reminders | ConvertTo-Json }
$zen = Read-Json (Join-Path $Root 'zen-gateway-status.json')
if ($zen) { $zen | ConvertTo-Json }
if ($active) {
    Write-Output ('Local health: ' + (Test-Release $active 5))
    try {
        $public = Invoke-RestMethod 'https://learn.ethanyanxu.com/api/health' -TimeoutSec 15
        Write-Output ('Public commit matches: ' + ($public.commit -eq $active.commit -and $public.hosting -eq 'finprint-host'))
    } catch { Write-Output 'Public health check failed.' }
}
