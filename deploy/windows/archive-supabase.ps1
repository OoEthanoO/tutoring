# A faithful copy of Supabase's public, auth and storage schemas, plus the
# settings the self-hosted database must match. Read-only on Supabase.
[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn')
. (Join-Path $PSScriptRoot 'common.ps1')
. (Join-Path $PSScriptRoot 'database.ps1')
Assert-Administrator
Install-PostgresBinaries $Root
$layout = Get-DatabaseLayout $Root
$folder = Join-Path $layout.Backups 'supabase'
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss') + 'Z'

$facts = @'
\pset footer off
\pset pager off
\qecho == server
select version(), current_setting('server_version_num') as version_num, current_setting('TimeZone') as timezone;
\qecho == database
select datname, pg_encoding_to_char(encoding) as encoding, datlocprovider, datcollate, datctype, datlocale,
       pg_size_pretty(pg_database_size(datname)) as size
from pg_database where datname = current_database();
\qecho == roles
select rolname, rolsuper, rolinherit, rolbypassrls, rolcanlogin, rolconfig
from pg_roles where rolname in ('postgres','anon','authenticated','service_role','authenticator','supabase_admin') order by 1;
\qecho == role settings
select coalesce(r.rolname, '(any role)') as role, coalesce(d.datname, '(any database)') as database, s.setconfig
from pg_db_role_setting s left join pg_roles r on r.oid = s.setrole left join pg_database d on d.oid = s.setdatabase order by 1, 2;
\qecho == extensions
select e.extname, e.extversion, n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace order by 1;
\qecho == event triggers
select evtname, evtevent, evtfoid::regproc as function, evtenabled from pg_event_trigger order by 1;
\qecho == publications
select p.pubname, p.puballtables,
       (select count(*) from pg_publication_tables t where t.pubname = p.pubname and t.schemaname = 'public') as public_tables
from pg_publication p order by 1;
\qecho == pg_cron
select case when to_regclass('cron.job') is null then 'not installed' else 'installed' end as pg_cron;
\qecho == public functions
select p.oid::regprocedure as function, p.prosecdef as security_definer, l.lanname as language, p.proconfig, p.proacl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
where n.nspname = 'public' order by 1;
\qecho == public function bodies naming other schemas
select p.oid::regprocedure as function,
       array(select distinct m[1] from regexp_matches(p.prosrc, '\m(extensions|auth|net|vault|cron|storage|realtime|graphql|pgsodium|supabase_functions)\.', 'g') as m) as schemas
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosrc ~ '\m(extensions|auth|net|vault|cron|storage|realtime|graphql|pgsodium|supabase_functions)\.' order by 1;
\qecho == execute_sql
select p.oid::regprocedure as function, p.prosecdef as security_definer, p.proacl, pg_get_functiondef(p.oid) as definition
from pg_proc p where p.proname = 'execute_sql';
\qecho == triggers on public tables
select t.tgname, t.tgrelid::regclass as table_name, t.tgfoid::regprocedure as function, t.tgenabled
from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal order by 2, 1;
\qecho == column defaults naming other schemas
select table_name, column_name, column_default from information_schema.columns
where table_schema = 'public' and column_default ~ '(extensions|auth|storage)\.' order by 1, 2;
\qecho == auth functions used by policies
select m[1] as auth_function, count(*) as uses
from pg_policies, regexp_matches(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '(auth\.[a-z_]+)\(', 'g') as m
where schemaname = 'public' group by 1 order by 1;
\qecho == policies naming roles
select distinct unnest(roles) as role from pg_policies where schemaname = 'public' order by 1;
\qecho == public objects other than tables and indexes
select c.relkind, count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind not in ('r', 'i', 't') group by 1 order by 1;
select t.typname, t.typtype from pg_type t join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public' and t.typtype in ('e', 'd', 'c', 'r', 'm')
  and not exists (select 1 from pg_class c where c.reltype = t.oid) order by 1;
\qecho == public tables
select c.relname as table_name, c.relrowsecurity as rls, s.n_live_tup as approx_rows,
       pg_size_pretty(pg_total_relation_size(c.oid)) as size
from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_stat_user_tables s on s.relid = c.oid
where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1;
\qecho == legacy auth and storage data
select (select count(*) from auth.users) as auth_users;
select (select count(*) from storage.buckets) as storage_buckets, (select count(*) from storage.objects) as storage_objects;
'@

try {
    Use-SupabaseSource $Root
    $factsSql = Join-Path $folder "facts-$stamp.sql"
    $factsOut = Join-Path $folder "facts-$stamp.txt"
    [IO.File]::WriteAllText($factsSql, $facts, (New-Object Text.UTF8Encoding $false))
    # A failing fact query must not stop the archive, so errors are reported, not fatal.
    $notices = Invoke-PgTool $layout.Bin 'psql' @('-X', '-q', '-v', 'ON_ERROR_STOP=0', '-f', $factsSql, '-o', $factsOut)
    Remove-Item -LiteralPath $factsSql

    $dump = Join-Path $folder "supabase-$stamp.dump"
    Invoke-PgTool $layout.Bin 'pg_dump' @('--format=custom', '--schema=public', '--schema=auth', '--schema=storage', "--file=$dump") | Out-Null
    $schema = Join-Path $folder "schema-public-$stamp.sql"
    Invoke-PgTool $layout.Bin 'pg_dump' @('--schema-only', '--schema=public', "--file=$schema") | Out-Null
} finally {
    Clear-PgEnvironment
}

$entries = @(Invoke-PgTool $layout.Bin 'pg_restore' @('--list', $dump) | Where-Object { $_ -and -not $_.StartsWith(';') })
$manifest = [ordered]@{
    TakenAt = (Get-Date).ToUniversalTime().ToString('o')
    Dump = Split-Path -Leaf $dump
    DumpBytes = (Get-Item -LiteralPath $dump).Length
    DumpSha256 = (Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash
    DumpEntries = $entries.Count
    PublicSchema = Split-Path -Leaf $schema
    Facts = Split-Path -Leaf $factsOut
}
Write-Json (Join-Path $folder "manifest-$stamp.json") $manifest
$manifest | Format-List | Out-String -Width 200 | Write-Output
if ($notices) { Write-Output '== psql notices'; $notices | Write-Output }
Get-Content -LiteralPath $factsOut | Write-Output
