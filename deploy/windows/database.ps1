# Shared by the self-hosted database scripts. Dot-source after common.ps1.
# Deployments copy only deploy\windows\*.ps1 into ops, so SQL lives in the
# scripts themselves rather than in separate files.
$script:PostgresVersion = '17.11'
# EDB's zip binaries are unsigned, but its installer is signed and can unpack
# the binaries without installing a service or creating a cluster.
$script:PostgresInstallerUrl = 'https://get.enterprisedb.com/postgresql/postgresql-17.11-1-windows-x64.exe'
$script:PgEnvironmentNames = @('PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD','PGSSLMODE','PGSSLROOTCERT','PGAPPNAME','PGCONNECT_TIMEOUT')

function Get-DatabaseLayout([string]$Root) {
    [pscustomobject]@{
        Home = Join-Path $Root 'postgres\17'
        Bin = Join-Path $Root 'postgres\17\bin'
        Data = Join-Path $Root 'postgres\data'
        Backups = Join-Path $Root 'backups'
        Source = Join-Path $Root 'secrets\supabase-source.json'
        SourcePassword = Join-Path $Root 'secrets\supabase-source.dpapi'
        SourceCa = Join-Path $Root 'secrets\supabase-ca.crt'
    }
}

# Machine scope, like the Cloudflare token: any local process could decrypt
# it, so the secrets folder's SYSTEM/Administrators ACL is the real boundary.
function Protect-MachineSecret([string]$Value) {
    Add-Type -AssemblyName System.Security
    $plain = [Text.Encoding]::UTF8.GetBytes($Value)
    try { return [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)) }
    finally { [Array]::Clear($plain, 0, $plain.Length) }
}

function Unprotect-MachineSecret([string]$Path) {
    Add-Type -AssemblyName System.Security
    $sealed = [Convert]::FromBase64String((Get-Content -LiteralPath $Path -Raw).Trim())
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($sealed, $null, [Security.Cryptography.DataProtectionScope]::LocalMachine)
    try { return [Text.Encoding]::UTF8.GetString($plain) } finally { [Array]::Clear($plain, 0, $plain.Length) }
}

# InstallBuilder cannot resolve the account inside an SSH logon ("Invalid
# account WORKGROUP\...") and then fails to write its helper scripts, so the
# installer runs as SYSTEM from a one-off scheduled task instead.
function Invoke-InstallerAsSystem([string]$Work, [string]$Installer, [string[]]$Arguments) {
    $temp = Join-Path $Work 'tmp'
    $result = Join-Path $Work 'installer-exit.txt'
    $inner = Join-Path $Work 'run-installer.ps1'
    New-Item -ItemType Directory -Path $temp -Force | Out-Null
    $argumentList = ($Arguments | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', '
    $body = @(
        "`$env:TEMP = '$temp'; `$env:TMP = '$temp'",
        "`$p = Start-Process -FilePath '$Installer' -Wait -PassThru -ArgumentList @($argumentList)",
        "[IO.File]::WriteAllText('$result', [string]`$p.ExitCode)"
    ) -join [Environment]::NewLine
    [IO.File]::WriteAllText($inner, $body, (New-Object Text.UTF8Encoding $false))
    $name = 'yanlearn-installer-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $inner)
    Register-ScheduledTask -TaskName $name -Action $action -User 'SYSTEM' -RunLevel Highest | Out-Null
    try {
        Start-ScheduledTask -TaskName $name
        $deadline = (Get-Date).AddMinutes(10)
        while (-not (Test-Path -LiteralPath $result) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
    } finally { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
    if (-not (Test-Path -LiteralPath $result)) { throw 'The installer did not finish within 10 minutes.' }
    $code = (Get-Content -LiteralPath $result -Raw).Trim()
    if ($code -ne '0') {
        $log = Get-ChildItem -LiteralPath $temp -Filter 'installbuilder_installer*.log' -Recurse | Select-Object -First 1
        $tail = if ($log) { (Get-Content -LiteralPath $log.FullName -Tail 4) -join ' | ' } else { 'no installer log' }
        throw "The installer exited with code ${code}: $tail"
    }
}

function Install-PostgresBinaries([string]$Root) {
    $layout = Get-DatabaseLayout $Root
    $postgres = Join-Path $layout.Bin 'postgres.exe'
    if (Test-Path -LiteralPath $postgres) {
        $installed = (& $postgres --version) -replace '^.* ', ''
        if ($installed -eq $script:PostgresVersion) { return }
        throw "PostgreSQL $installed is already in $($layout.Home); expected $script:PostgresVersion. Upgrade it deliberately."
    }
    $work = Join-Path $Root ('downloads\postgresql-{0}-{1}' -f $script:PostgresVersion, [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $work -Force | Out-Null
    try {
        $installer = Join-Path $work (Split-Path -Leaf $script:PostgresInstallerUrl)
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $script:PostgresInstallerUrl -OutFile $installer
        $signature = Get-AuthenticodeSignature -LiteralPath $installer
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'EnterpriseDB') {
            throw "Unexpected installer signature: $($signature.Status) $($signature.SignerCertificate.Subject)"
        }
        $extracted = Join-Path $work 'extracted'
        Invoke-InstallerAsSystem $work $installer @('--mode', 'unattended', '--unattendedmodeui', 'none',
            '--extract-only', '1', '--prefix', "`"$extracted`"")
        $version = (& (Join-Path $extracted 'bin\postgres.exe') --version) -replace '^.* ', ''
        if ($version -ne $script:PostgresVersion) { throw "The download is PostgreSQL $version, not $script:PostgresVersion." }
        # Only the server and command-line tools are kept.
        foreach ($extra in 'pgAdmin 4', 'stackbuilder', 'StackBuilder') {
            Remove-Item -LiteralPath (Join-Path $extracted $extra) -Recurse -Force -ErrorAction SilentlyContinue
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $layout.Home) -Force | Out-Null
        Move-Item -LiteralPath $extracted -Destination $layout.Home
    } finally {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# libpq reads these, so the password never reaches a command line or a log.
function Use-SupabaseSource([string]$Root) {
    $layout = Get-DatabaseLayout $Root
    $source = Read-Json $layout.Source
    if (-not $source -or -not (Test-Path -LiteralPath $layout.SourcePassword)) { throw 'Run set-database-source.ps1 first.' }
    $env:PGHOST = $source.Host
    $env:PGPORT = [string]$source.Port
    $env:PGUSER = $source.User
    $env:PGDATABASE = $source.Database
    $env:PGPASSWORD = Unprotect-MachineSecret $layout.SourcePassword
    if (Test-Path -LiteralPath $layout.SourceCa) { $env:PGSSLMODE = 'verify-full'; $env:PGSSLROOTCERT = $layout.SourceCa }
    else { $env:PGSSLMODE = 'require'; Remove-Item Env:PGSSLROOTCERT -ErrorAction SilentlyContinue }
    $env:PGAPPNAME = 'yanlearn-migration'
    $env:PGCONNECT_TIMEOUT = '20'
}

function Clear-PgEnvironment {
    foreach ($name in $script:PgEnvironmentNames) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
}

# Returns the tool's output; PowerShell 5.1 would otherwise turn every
# stderr notice into a terminating error under Stop.
function Invoke-PgTool([string]$Bin, [string]$Tool, [string[]]$Arguments) {
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $output = @(& (Join-Path $Bin "$Tool.exe") @Arguments 2>&1 | ForEach-Object { "$_" }) }
    finally { $ErrorActionPreference = $oldPreference }
    if ($LASTEXITCODE -ne 0) { throw ("$Tool failed with exit code ${LASTEXITCODE}: " + (($output | Select-Object -Last 6) -join ' | ')) }
    return $output
}
