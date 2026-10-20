# Records how to reach Supabase's database for the move to finprint-host:
# host, port, user and database in secrets\supabase-source.json, and the
# password DPAPI-encrypted beside it. Run interactively (ssh -t); nothing is
# echoed. Delete both files once the move is complete.
[CmdletBinding()]
param(
    [string]$Root = 'C:\ProgramData\YanLearn',
    # Optional, without the password; otherwise it is asked for, hidden.
    [string]$ConnectionString
)
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'database.ps1')
Assert-Administrator
$layout = Get-DatabaseLayout $Root
Install-PostgresBinaries $Root

function Read-Hidden([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

if ($ConnectionString) {
    $text = $ConnectionString.Trim()
} else {
    Write-Host 'Supabase dashboard -> Connect -> Session pooler: copy the connection string.'
    Write-Host 'Its [YOUR-PASSWORD] placeholder is fine; you will be asked for the password next.'
    $text = (Read-Hidden 'Connection string (hidden)').Trim()
}
# [Uri] rejects brackets in the user part, so drop the dashboard's placeholder.
$text = $text -replace ':\[[^\]@]*\]@', '@'
$uri = $null
if (-not [Uri]::TryCreate($text, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin 'postgres','postgresql') {
    throw 'That is not a postgresql:// connection string.'
}
if ($uri.Host -notmatch '\.supabase\.(com|co)$') { throw "Unexpected host $($uri.Host); expected Supabase's pooler or database host." }
$port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
# pg_dump needs a session, which the transaction pooler (6543) does not keep.
if ($port -ne 5432) { throw "Port $port is the transaction pooler. Copy the Session pooler string (port 5432)." }
$user, $embedded = $uri.UserInfo -split ':', 2
$user = [Uri]::UnescapeDataString($user)
$database = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart('/'))
if (-not $database) { $database = 'postgres' }
if (-not $user) { throw 'The connection string has no user name.' }

if ($embedded -and $ConnectionString) {
    throw "Don't put the password on the command line, where shell history keeps it. Leave it out; you will be asked for it."
}
$password = if ($embedded) { [Uri]::UnescapeDataString($embedded) } else { Read-Hidden 'Database password (hidden)' }
if (-not $password) { throw 'No password was entered.' }

Write-Json $layout.Source ([ordered]@{ Host = $uri.Host; Port = $port; User = $user; Database = $database; StoredAt = (Get-Date).ToUniversalTime().ToString('o') })
[IO.File]::WriteAllText($layout.SourcePassword, (Protect-MachineSecret $password), [Text.Encoding]::ASCII)
$password = $null

try {
    Use-SupabaseSource $Root
    $answer = Invoke-PgTool $layout.Bin 'psql' @('-X', '-A', '-t', '-c', "select current_user || ' | ' || version()")
    Write-Host ('Connected (sslmode=' + $env:PGSSLMODE + '): ' + ($answer -join ' '))
} catch {
    throw "Saved, but the test connection failed: $($_.Exception.Message)"
} finally {
    Clear-PgEnvironment
}
