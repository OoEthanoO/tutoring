# Applies a migration to the self-hosted database: as yanlearn_owner, so the
# default privileges give service_role (every API request) the new objects,
# in one transaction unless the file manages its own, recorded with its
# SHA-256 in yanlearn_meta.migrations, then PostgREST reloads its schema
# cache. Apply a migration BEFORE pushing code that reads it:
#   scp supabase/migrations/<file>.sql finprint-host:C:/ProgramData/YanLearn/migrations/
#   ssh finprint-host "powershell -NoProfile -ExecutionPolicy Bypass -File C:\ProgramData\YanLearn\ops\apply-migration.ps1 -Path C:\ProgramData\YanLearn\migrations\<file>.sql"
# -MarkExisting <folder> records every *.sql there as applied without running
# it (done once for the files applied by hand on Supabase).
[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn', [string]$Path, [string]$MarkExisting)
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'database.ps1')
Assert-Administrator

function ConvertTo-SqlLiteral([string]$Value) { return "'" + $Value.Replace("'", "''") + "'" }

try {
    Use-LocalDatabase $Root 'postgres' 'yanlearn'
    Invoke-Sql $Root @'
create schema if not exists yanlearn_meta;
revoke all on schema yanlearn_meta from public;
create table if not exists yanlearn_meta.migrations (
  name text primary key,
  sha256 text not null,
  applied_at timestamptz
);
'@ | Out-Null

    if ($MarkExisting) {
        $files = @(Get-ChildItem -LiteralPath $MarkExisting -Filter '*.sql' | Sort-Object Name)
        $values = $files | ForEach-Object {
            '({0}, {1}, null)' -f (ConvertTo-SqlLiteral $_.Name), (ConvertTo-SqlLiteral (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())
        }
        # applied_at stays null: these ran by hand on Supabase, at unknown times.
        Invoke-Sql $Root ("insert into yanlearn_meta.migrations (name, sha256, applied_at) values`n" + ($values -join ",`n") + "`non conflict (name) do nothing;") | Out-Null
        Write-Output "Recorded $($files.Count) existing migrations as applied."
        return
    }

    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'Pass -Path <migration.sql>, copied to the server first.' }
    $name = Split-Path -Leaf $Path
    $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    $recorded = ((Invoke-Sql $Root ("select sha256 from yanlearn_meta.migrations where name = {0};" -f (ConvertTo-SqlLiteral $name)) @('-A', '-t')) -join '').Trim()
    if ($recorded -eq $hash) { Write-Output "$name is already applied."; return }
    if ($recorded) { throw "$name was applied with different contents. Write a new migration instead of editing an applied one." }

    $body = [IO.File]::ReadAllText($Path)
    $ownTransaction = $body -match '(?im)^\s*(begin|commit|start transaction)\s*;'
    $sql = "set role yanlearn_owner;`n$body`nreset role;`n" +
        ("insert into yanlearn_meta.migrations (name, sha256, applied_at) values ({0}, {1}, now());`n" -f (ConvertTo-SqlLiteral $name), (ConvertTo-SqlLiteral $hash)) +
        "notify pgrst, 'reload schema';"
    $arguments = if ($ownTransaction) { @() } else { @('--single-transaction') }
    Invoke-Sql $Root $sql $arguments | Out-Null
    Write-Output "Applied $name$(if ($ownTransaction) { ' (it manages its own transaction)' } else { ' in one transaction' }); PostgREST reloads its schema."
} finally {
    Clear-PgEnvironment
}
