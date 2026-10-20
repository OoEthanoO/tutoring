# Runs db-cutover.ps1 as a one-off SYSTEM task, so a dropped SSH session cannot
# stop it halfway, and shows logs\db-cutover.log until it finishes.
# -Rollback runs db-cutover.ps1 -Rollback the same way.
[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn', [switch]$Rollback)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Administrator
$log = Join-Path $Root 'logs\db-cutover.log'
$offset = if (Test-Path -LiteralPath $log) { (Get-Item -LiteralPath $log).Length } else { 0 }
$name = 'yanlearn-db-cutover'
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Root "{1}"{2}' -f (Join-Path $PSScriptRoot 'db-cutover.ps1'), $Root, $(if ($Rollback) { ' -Rollback' } else { '' })
Register-ScheduledTask -TaskName $name -Action (New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments) -User 'SYSTEM' -RunLevel Highest `
    -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30)) -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Host "Started. Following $log; closing this window does not stop it."
do {
    Start-Sleep -Seconds 2
    if (Test-Path -LiteralPath $log) {
        $stream = [IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')
        try {
            $null = $stream.Seek($offset, 'Begin')
            $text = (New-Object IO.StreamReader($stream)).ReadToEnd()
            $offset = $stream.Position
        } finally { $stream.Dispose() }
        if ($text) { Write-Host -NoNewline $text }
    }
    $state = (Get-ScheduledTask -TaskName $name).State
} while ($state -in 'Running', 'Queued')
$result = (Get-ScheduledTaskInfo -TaskName $name).LastTaskResult
Unregister-ScheduledTask -TaskName $name -Confirm:$false
Write-Host $(if ($result -eq 0) { 'Finished successfully.' } else { "Finished with errors (exit code $result); see the lines above." })
