[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn')
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Administrator
$settings = Join-Path $Root 'secrets\cloudflare-ddns.json'
if (-not (Test-Path -LiteralPath $settings)) { throw 'Import the scoped token and pinned record configuration first.' }
$updater = Join-Path $Root 'ops\update-cloudflare-dns.ps1'
if ([IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') -ne [IO.Path]::GetFullPath((Join-Path $Root 'ops')).TrimEnd('\')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'update-cloudflare-dns.ps1') -Destination $updater -Force
}
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $updater -SettingsPath $settings
if ($LASTEXITCODE -ne 0) { throw 'Initial Cloudflare DNS verification failed; no task was registered.' }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -SettingsPath "{1}"' -f $updater,$settings)
$startup = New-ScheduledTaskTrigger -AtStartup
$startup.Delay = 'PT1M'
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 5)
$options = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4) `
    -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'ethanyanxu-cloudflare-ddns' -Action $action -Trigger @($startup,$repeat) -Settings $options -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName 'ethanyanxu-cloudflare-ddns'
Write-Output 'Cloudflare home-server DNS updater installed for startup and every five minutes.'
