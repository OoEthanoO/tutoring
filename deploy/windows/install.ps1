[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn', [Parameter(Mandatory)][string]$CaddyExe,
    [Parameter(Mandatory)][string]$MainCaddyfile, [switch]$EnableAutoDeploy,
    [switch]$EnableReminders, [switch]$ExternalRemindersDisabled)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Administrator
if ($EnableReminders -and -not $ExternalRemindersDisabled) {
    throw 'Disable the cron-job.org reminders job first, then supply -ExternalRemindersDisabled.'
}
foreach ($name in @('secrets','logs','releases','static','ops')) {
    New-Item -ItemType Directory -Path (Join-Path $Root $name) -Force | Out-Null
}
# The application secrets, logs and runtime are readable only by the server's
# administrators and SYSTEM, which runs the web and deployment tasks.
& icacls.exe $Root '/inheritance:r' '/grant:r' '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the deployment directory.' }
$config = [pscustomobject]@{
    node=(Get-Command node.exe).Source; npm=(Get-Command npm.cmd).Source; git=(Get-Command git.exe).Source
    caddy=(Resolve-Path -LiteralPath $CaddyExe).Path; mainCaddyfile=(Resolve-Path -LiteralPath $MainCaddyfile).Path
}
Write-Json (Join-Path $Root 'server.json') $config
$repo = Join-Path $Root 'repo'
if (-not (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
    Invoke-Tool $config.git @('clone','--branch','master','https://github.com/OoEthanoO/tutoring.git',$repo) (Join-Path $Root 'logs\install.log')
}
$ops = Join-Path $Root 'ops'
if ([IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') -ne [IO.Path]::GetFullPath($ops).TrimEnd('\')) {
    Copy-Item -Path (Join-Path $PSScriptRoot '*.ps1') -Destination $ops -Force
}
if ($EnableAutoDeploy) {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Root "{1}"' -f (Join-Path $Root 'ops\tick.ps1'),$Root)
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 25) `
        -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName 'yanlearn-deploy' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
}
if ($EnableReminders) {
    if (-not (Read-Json (Join-Path $Root 'active.json'))) { throw 'Activate a healthy release before enabling reminders.' }
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Root "{1}"' -f (Join-Path $Root 'ops\reminders.ps1'),$Root)
    $triggers = @(
        (New-ScheduledTaskTrigger -AtStartup),
        (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1))
    )
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName 'yanlearn-reminders' -Action $action -Trigger $triggers -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
}
Write-Output "Installed runtime layout at $Root. Import secrets\production.json, then run ops\deploy.ps1."
