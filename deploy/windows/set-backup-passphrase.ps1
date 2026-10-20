# Sets the passphrase that encrypts database backups before they leave this
# server. Keep it in a password manager: without it the offsite copies cannot
# be decrypted, and nothing in them can recover it. Run interactively (ssh -t).
[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn')
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'database.ps1')
Assert-Administrator
$path = Join-Path $Root 'secrets\db-backup-passphrase.dpapi'
if (Test-Path -LiteralPath $path) { Write-Host 'This replaces the current passphrase; copies already made still need the old one.' }
$first = Read-Hidden 'Backup passphrase, at least 12 characters (hidden)'
$second = Read-Hidden 'Type it again (hidden)'
if ($first -cne $second) { throw 'The two entries differ; nothing was saved.' }
if ($first.Length -lt 12) { throw 'Use at least 12 characters; nothing was saved.' }
[IO.File]::WriteAllText($path, (Protect-MachineSecret $first), [Text.Encoding]::ASCII)
$first = $null; $second = $null
Write-Host 'Saved. Put the same passphrase in your password manager now.'
