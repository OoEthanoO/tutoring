# Copies Supabase's public schema into the self-hosted yanlearn database and
# checks the copy against Supabase. -Mode Trial runs while the site still uses
# Supabase, so rows written every minute may differ; it also exercises the copy
# with writes and a copy of the active release on port 3199. -Mode Cutover runs
# inside the write freeze: every table must match exactly, and nothing writes.
# Run it before production.json points at the new database.
[CmdletBinding()]
param(
    [string]$Root = 'C:\ProgramData\YanLearn',
    [ValidateSet('Trial', 'Cutover')][string]$Mode = 'Trial',
    [string]$CompareScript = 'C:\ProgramData\YanLearn\repo\scripts\compare-databases.mjs'
)
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'database.ps1')
Assert-Administrator
$layout = Get-DatabaseLayout $Root
$settings = Read-Json $layout.Settings
$production = Read-Json (Join-Path $Root 'secrets\production.json')
$config = Read-Json (Join-Path $Root 'server.json')
if (-not $settings) { throw 'Run install-database.ps1 first.' }
if (([Uri][string]$production.SUPABASE_URL).Host -eq '127.0.0.1') { throw 'production.json already points at the local database; copying again would overwrite live data.' }
if (-not (Test-Path -LiteralPath $CompareScript)) { throw "Missing $CompareScript." }
$work = Join-Path $layout.Backups 'restore'
New-Item -ItemType Directory -Path $work -Force | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss') + 'Z'
$report = [ordered]@{ Mode = $Mode; StartedAt = (Get-Date).ToUniversalTime().ToString('o'); Seconds = [ordered]@{}; Failures = @() }

function Measure-Step([string]$Name, [scriptblock]$Body) {
    $started = Get-Date
    try { & $Body } finally { $report.Seconds[$Name] = [math]::Round(((Get-Date) - $started).TotalSeconds, 1) }
}
function Add-Failure([string]$Message) { $report.Failures += $Message; Write-Output "FAIL: $Message" }
# The same read-only SQL on Supabase and on the copy.
function Invoke-OnSource([string]$Sql) {
    try { Use-SupabaseSource $Root; return Invoke-Sql $Root $Sql @('-A', '-t', '-F', '|') } finally { Clear-PgEnvironment }
}
function Invoke-OnCopy([string]$Sql, [string]$User = 'postgres') {
    try { Use-LocalDatabase $Root $User 'yanlearn'; return Invoke-Sql $Root $Sql @('-A', '-t', '-F', '|') } finally { Clear-PgEnvironment }
}

# 1. Copy.
$dump = Join-Path $work "public-$stamp.dump"
Measure-Step 'dump' {
    try { Use-SupabaseSource $Root; Invoke-PgTool $layout.Bin 'pg_dump' @('--format=custom', '--schema=public', "--file=$dump") | Out-Null }
    finally { Clear-PgEnvironment }
}
Measure-Step 'restore' {
    try {
        New-YanLearnDatabase $Root -ForRestore
        Use-LocalDatabase $Root 'postgres' 'yanlearn'
        # --no-owner/--no-privileges belong here: pg_dump ignores them for
        # archives. --role makes yanlearn_owner the owner of everything.
        Invoke-PgTool $layout.Bin 'pg_restore' @('--dbname=yanlearn', '--role=yanlearn_owner', '--no-owner', '--no-privileges',
            '--no-publications', '--no-subscriptions', '--exit-on-error', '--single-transaction', $dump) | Out-Null
        Invoke-Sql $Root ($script:PrivilegesSql + "`ndrop function if exists public.execute_sql(text);`nanalyze;") | Out-Null
    } finally { Clear-PgEnvironment }
    Restart-Postgrest
}

# 2. Same objects (execute_sql is deliberately not copied).
$inventorySql = @'
select 'tables', count(*) from pg_tables where schemaname = 'public'
union all select 'columns', count(*) from information_schema.columns where table_schema = 'public'
union all select 'indexes', count(*) from pg_indexes where schemaname = 'public'
union all select 'constraints', count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public'
union all select 'triggers', count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal
union all select 'policies', count(*) from pg_policies where schemaname = 'public'
union all select 'functions', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname <> 'execute_sql'
order by 1;
'@
Measure-Step 'inventory' {
    $sourceInventory = Invoke-OnSource $inventorySql
    $copyInventory = Invoke-OnCopy $inventorySql
    Write-Output ('objects: ' + ($copyInventory -join ', '))
    if (($sourceInventory -join ';') -ne ($copyInventory -join ';')) { Add-Failure ('object counts differ: source ' + ($sourceInventory -join ', ')) }
}

# 3. Same rows: per-table count and checksum, with output settings pinned and
# ordering by bytes so collation differences cannot reorder rows.
Measure-Step 'checksums' {
    $tables = @(Invoke-OnCopy "select tablename from pg_tables where schemaname = 'public' order by 1;")
    $sql = "set timezone = 'UTC'; set datestyle = 'ISO, MDY'; set intervalstyle = 'postgres'; set extra_float_digits = 1; set bytea_output = 'hex';`n" +
        (($tables | ForEach-Object { "select '$_', count(*), md5(coalesce(string_agg(x::text, E'\n' order by x::text collate `"C`"), '')) from public.`"$_`" x" }) -join "`nunion all ") + "`norder by 1;"
    $sourceRows = @(Invoke-OnSource $sql | Where-Object { $_ -match '\|' })
    $copyRows = @(Invoke-OnCopy $sql | Where-Object { $_ -match '\|' })
    $different = @(Compare-Object $sourceRows $copyRows -PassThru | Where-Object { $_.SideIndicator -eq '=>' } | ForEach-Object { ($_ -split '\|')[0] })
    $report.Tables = $copyRows.Count
    $report.DifferentTables = $different
    Write-Output ("checksums: {0} tables, {1} different{2}" -f $copyRows.Count, $different.Count, $(if ($different) { ': ' + ($different -join ', ') } else { '' }))
    if ($different -and $Mode -eq 'Cutover') { Add-Failure ('tables differ inside the freeze: ' + ($different -join ', ')) }
}

# 4. Privileges: service_role reaches everything, anon nothing, and the
# superuser owns nothing that runs as SECURITY DEFINER.
Measure-Step 'privileges' {
    $gaps = @(Invoke-OnCopy @'
select 'service_role cannot use table ' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and not has_table_privilege('service_role', c.oid, 'select, insert, update, delete')
union all select 'service_role cannot run ' || p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and not has_function_privilege('service_role', p.oid, 'execute')
union all select 'anon can run ' || p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
union all select 'anon can read ' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege('anon', c.oid, 'select')
union all select 'not owned by yanlearn_owner: ' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and pg_get_userbyid(c.relowner) <> 'yanlearn_owner'
union all select 'function not owned by yanlearn_owner: ' || p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and pg_get_userbyid(p.proowner) <> 'yanlearn_owner';
'@ | Where-Object { $_ })
    Write-Output ('privilege gaps: ' + $gaps.Count)
    foreach ($gap in $gaps) { Add-Failure $gap }
}

# 5. The app's query shapes through both PostgREST endpoints.
Measure-Step 'compare' {
    # Releases bundle supabase-js into their server chunks; the deploy checkout
    # has the same version installed. (A deploy's npm ci would replace it
    # mid-run, which the cutover rules out by holding deploy.lock.)
    $env:YANLEARN_APP_DIR = Join-Path $Root 'repo'
    $env:SOURCE_URL = [string]$production.SUPABASE_URL
    $env:SOURCE_KEY = [string]$production.SUPABASE_SERVICE_ROLE_KEY
    $env:TARGET_URL = 'http://127.0.0.1:{0}' -f $script:DatabaseGatewayPort
    $env:TARGET_KEY = [string]$settings.ServiceRoleKey
    $env:COMPARE_STRICT = $(if ($Mode -eq 'Cutover') { '1' } else { '0' })
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = @(& $config.node $CompareScript 2>&1 | ForEach-Object { "$_" })
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $oldPreference
        Remove-Item Env:YANLEARN_APP_DIR, Env:SOURCE_URL, Env:SOURCE_KEY, Env:TARGET_URL, Env:TARGET_KEY, Env:COMPARE_STRICT -ErrorAction SilentlyContinue
    }
    $output | Write-Output
    if ($code -ne 0) { Add-Failure 'the query comparison found unexplained differences' }
}

if ($Mode -eq 'Trial') {
    # 6. Writes, on the copy only: RPCs through PostgREST, and triggers and
    # defaults inside a transaction that is rolled back.
    Measure-Step 'writes' {
        $headers = @{ Authorization = 'Bearer ' + $settings.ServiceRoleKey; 'Content-Type' = 'application/json' }
        function Invoke-Rpc([string]$Name, [hashtable]$Body) {
            try {
                $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri ('http://127.0.0.1:{0}/rest/v1/rpc/{1}' -f $script:DatabaseGatewayPort, $Name) -Headers $headers -Body ($Body | ConvertTo-Json -Compress) -TimeoutSec 15
                return "$($response.StatusCode)"
            } catch {
                $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
                $text = ''
                if ($_.ErrorDetails) { $text = $_.ErrorDetails.Message }
                return "$status $text"
            }
        }
        $token = [Guid]::NewGuid().ToString()
        $results = [ordered]@{
            claim_zen_mode_sync = Invoke-Rpc 'claim_zen_mode_sync' @{ p_token = $token }
            release_zen_mode_sync = Invoke-Rpc 'release_zen_mode_sync' @{ p_token = $token }
            class_exercise_action = Invoke-Rpc 'class_exercise_action' @{ p_class_id = [Guid]::NewGuid().ToString(); p_actor = [Guid]::NewGuid().ToString(); p_action = 'claim_announcement'; p_input = @{} }
            save_class_trial = Invoke-Rpc 'save_class_trial' @{ p_class_id = [Guid]::NewGuid().ToString(); p_discord_user_id = '123456789012345678'; p_student_name = 'Trial check'; p_actor_id = [Guid]::NewGuid().ToString() }
            execute_sql = Invoke-Rpc 'execute_sql' @{ sql = 'select 1' }
        }
        $results.GetEnumerator() | ForEach-Object { Write-Output ('rpc {0}: {1}' -f $_.Key, ($_.Value -replace '\s+', ' ')) }
        # Reached and ran: success or a domain error. Missing (404) or refused (401/403) means broken.
        foreach ($name in 'claim_zen_mode_sync', 'release_zen_mode_sync', 'class_exercise_action', 'save_class_trial') {
            if ($results[$name] -match '^(0|401|403|404)\b') { Add-Failure "rpc $name did not run: $($results[$name])" }
        }
        if ($results.execute_sql -notmatch '^404\b') { Add-Failure 'execute_sql is still callable' }
        $rolledBack = Invoke-OnCopy @'
begin;
set local role service_role;
insert into public.daily_donations (date, amount) values ('1900-01-01', 1) returning (id is not null) as default_uuid;
insert into public.banned_emails (email) values ('trial-check@invalid.example') returning 'ban trigger ran';
rollback;
'@
        Write-Output ('rolled-back writes: ' + (($rolledBack | Where-Object { $_ -and $_ -notmatch '^(BEGIN|SET|INSERT|ROLLBACK)' }) -join ', '))
        if (($rolledBack -join ' ') -notmatch '\bt\b') { Add-Failure 'the uuid_generate_v4() default did not produce an id' }
    }

    # 7. The active release, copied (its ISR cache must not see this), on port
    # 3199 against the copy, with every outside service disabled.
    Measure-Step 'release' {
        $active = Read-Json (Join-Path $Root 'active.json')
        $trialApp = Join-Path $Root 'checks\release-3199'
        if (Test-Path -LiteralPath $trialApp) { Remove-Item -LiteralPath $trialApp -Recurse -Force }
        Copy-DirectoryContents (Join-Path $active.release 'app') $trialApp
        $saved = @{}
        $overrides = @{
            SUPABASE_URL = 'http://127.0.0.1:{0}' -f $script:DatabaseGatewayPort
            SUPABASE_SERVICE_ROLE_KEY = [string]$settings.ServiceRoleKey
            DISCORD_BOT_TOKEN = 'trial-disabled'; RESEND_API_KEY = 'trial-disabled'; CRON_SECRET = (New-RandomSecret 24)
            RECORDINGS_S3_ACCESS_KEY_ID = 'trial-disabled'; RECORDINGS_S3_SECRET_ACCESS_KEY = 'trial-disabled'
            PORT = '3199'; HOSTNAME = '127.0.0.1'; YANLEARN_ZEN_GATEWAY_PORT = '3198'
        }
        Import-ProductionEnvironment $Root
        foreach ($name in $overrides.Keys) { $saved[$name] = [Environment]::GetEnvironmentVariable($name); [Environment]::SetEnvironmentVariable($name, $overrides[$name]) }
        $server = $null
        try {
            $server = Start-Process -FilePath $config.node -ArgumentList 'server.js' -WorkingDirectory $trialApp -PassThru -WindowStyle Hidden `
                -RedirectStandardOutput (Join-Path $work 'release-3199.out.log') -RedirectStandardError (Join-Path $work 'release-3199.err.log')
            $deadline = (Get-Date).AddSeconds(60)
            do { Start-Sleep -Seconds 1; $up = try { (Invoke-RestMethod 'http://127.0.0.1:3199/api/health' -TimeoutSec 3).status -eq 'ok' } catch { $false } } until ($up -or (Get-Date) -gt $deadline)
            if (-not $up) { Add-Failure 'the release copy did not become healthy on 3199'; return }
            $count = (Invoke-RestMethod 'http://127.0.0.1:3199/api/team/count' -TimeoutSec 20).count
            $letter = Invoke-WebRequest -UseBasicParsing -Method Head -Uri 'http://127.0.0.1:3199/Letter%20of%20Support%20from%20SickKids%20Foundation.pdf' -TimeoutSec 20
            Write-Output ("release on 3199: health ok, team count {0}, letter {1} {2}" -f $count, $letter.StatusCode, $letter.Headers['Content-Type'])
            if ($letter.StatusCode -ne 200) { Add-Failure 'the Letter of Support did not load through middleware' }
            # Middleware reads maintenance_mode from the database it is given.
            Invoke-OnCopy 'update public.site_settings set maintenance_mode = true where id;' | Out-Null
            $redirect = try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3199/' -MaximumRedirection 0 -TimeoutSec 20 -ErrorAction Stop; $null } catch { $_.Exception.Response.Headers['Location'] }
            Invoke-OnCopy 'update public.site_settings set maintenance_mode = false where id;' | Out-Null
            Write-Output ('maintenance redirect from the copy: ' + $redirect)
            if ([string]$redirect -notmatch '/maintenance') { Add-Failure 'middleware did not read maintenance_mode from the copy' }
        } finally {
            if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
            foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
            Start-Sleep -Seconds 2
            Remove-Item -LiteralPath $trialApp -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

$report.FinishedAt = (Get-Date).ToUniversalTime().ToString('o')
$report.Dump = Split-Path -Leaf $dump
Write-Json (Join-Path $work "report-$Mode-$stamp.json") $report
Write-Output ('timings (s): ' + (($report.Seconds.GetEnumerator() | ForEach-Object { "$($_.Key) $($_.Value)" }) -join ', '))
if ($report.Failures.Count) { throw ("$Mode copy failed {0} check(s): " -f $report.Failures.Count) + ($report.Failures -join '; ') }
Write-Output "$Mode copy passed every check."
