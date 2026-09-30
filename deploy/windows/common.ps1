# Native Windows PowerShell 5.1. Runtime files stay outside the source checkout.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run from an Administrator PowerShell or the server administrator SSH account.'
    }
}

function Read-Json([string]$Path) {
    if (Test-Path -LiteralPath $Path) { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
    return $null
}

function Write-Json([string]$Path, $Value) {
    $temporary = $Path + '.new'
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding $false))
    # PowerShell 5.1 coerces $null to an empty string for this .NET argument,
    # which File.Replace rejects as an invalid backup path.
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
    else { [IO.File]::Move($temporary, $Path) }
}

function Assert-UnderRoot([string]$Path, [string]$Root) {
    $resolved = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Path is outside the deployment root: $resolved" }
    return $resolved
}

function Copy-DirectoryContents([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw "Missing asset directory: $Source" }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    # Next.js can already trace part of public/ or assets/ into standalone.
    # Copying a directory onto an existing directory nests its name again.
    # Merge each level explicitly, including hidden files and literal names.
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        $target = Join-Path $Destination $item.Name
        if ($item.PSIsContainer) { Copy-DirectoryContents $item.FullName $target }
        else { Copy-Item -LiteralPath $item.FullName -Destination $target -Force }
    }
}

function Import-ProductionEnvironment([string]$Root) {
    $values = Read-Json (Join-Path $Root 'secrets\production.json')
    if (-not $values) { throw 'Missing secrets\production.json. Import the production configuration before deploying.' }
    $required = @('NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY',
        'NEXT_PUBLIC_SITE_URL','CRON_SECRET','RESEND_API_KEY','RESEND_FROM','DISCORD_BOT_TOKEN',
        'DISCORD_GUILD_ID','DISCORD_CLIENT_ID','DISCORD_CLIENT_SECRET','DISCORD_OAUTH_REDIRECT_URI',
        'RECORDINGS_S3_ENDPOINT','RECORDINGS_S3_ACCESS_KEY_ID','RECORDINGS_S3_SECRET_ACCESS_KEY')
    $missing = @($required | Where-Object { -not $values.$_ })
    if ($missing.Count) { throw ('Missing production settings: ' + ($missing -join ', ')) }
    foreach ($name in @('NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SITE_URL','DISCORD_OAUTH_REDIRECT_URI','RECORDINGS_S3_ENDPOINT')) {
        $uri = $null
        if (-not [Uri]::TryCreate([string]$values.$name, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https') {
            throw "Invalid HTTPS setting: $name. Import the decrypted value, not a provider's encrypted envelope."
        }
    }
    foreach ($name in @('DISCORD_CLIENT_ID','DISCORD_GUILD_ID')) {
        if ([string]$values.$name -notmatch '^\d{17,20}$') { throw "Invalid Discord identifier: $name" }
    }
    foreach ($p in $values.PSObject.Properties) { [Environment]::SetEnvironmentVariable($p.Name, [string]$p.Value, 'Process') }
    $env:NODE_ENV = 'production'
    $env:NEXT_TELEMETRY_DISABLED = '1'
    $env:YANLEARN_HOST = 'finprint-host'
    $env:VERCEL_GIT_COMMIT_REF = 'master'
    $env:VERCEL_GIT_REPO_OWNER = 'OoEthanoO'
    $env:VERCEL_GIT_REPO_SLUG = 'tutoring'
}

function Invoke-Tool([string]$File, [string[]]$Arguments, [string]$Log) {
    # PowerShell 5.1 turns native stderr into exceptions under Stop, even for
    # harmless npm/git progress. The process exit code determines success.
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $File @Arguments >> $Log 2>&1
    $code = $LASTEXITCODE
    $ErrorActionPreference = $oldPreference
    if ($code -ne 0) { throw "Tool failed with exit code $code. See $Log" }
}

function Test-Release($State, [int]$Seconds = 60) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try {
            $health = Invoke-RestMethod -Uri ('http://127.0.0.1:{0}/api/health' -f $State.port) -TimeoutSec 5
            if ($health.status -eq 'ok' -and $health.commit -eq $State.commit) { return $true }
        } catch {}
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Register-WebTask([string]$Root, $State) {
    $runScript = Join-Path $State.release 'ops\run.ps1'
    $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -Root "{1}" -Release "{2}" -Port {3} -Commit {4}' -f $runScript,$Root,$State.release,$State.port,$State.commit
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $State.release
    $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $State.taskName -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) `
        -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
    Start-ScheduledTask -TaskName $State.taskName
}

function Stop-WebTask([string]$Root, $State) {
    if (-not $State -or $State.taskName -notlike 'yanlearn-web-*') { return }
    $release = Assert-UnderRoot $State.release (Join-Path $Root 'releases')
    # A local cron request may outlast the ordinary deployment drain. Holding
    # its lock until process retirement also prevents a new request racing us.
    $remindersLock = $null
    try {
        while (-not $remindersLock) {
            try { $remindersLock = [IO.File]::Open((Join-Path $Root 'reminders.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
            catch [IO.IOException] { Start-Sleep -Seconds 2 }
        }
        Disable-ScheduledTask -TaskName $State.taskName -ErrorAction SilentlyContinue | Out-Null
        Stop-ScheduledTask -TaskName $State.taskName -ErrorAction SilentlyContinue
        # Remove only an orphaned node process from this exact release, never every
        # node process on the shared host. Normally Task Scheduler already killed it.
        $server = Join-Path $release 'app\server.js'
        Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
            $_.CommandLine -and $_.CommandLine.Contains($server)
        } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } finally { if ($remindersLock) { $remindersLock.Dispose() } }
}

function Switch-Caddy([string]$Root, $Config, [int]$Port) {
    $sitePath = Join-Path $Root 'Caddyfile'
    $oldSite = if (Test-Path -LiteralPath $sitePath) { [IO.File]::ReadAllText($sitePath) } else { $null }
    $oldMain = [IO.File]::ReadAllText($Config.mainCaddyfile)
    $staticPath = (Join-Path $Root 'static') -replace '\\','/'
    $logPath = (Join-Path $Root 'logs\access.log') -replace '\\','/'
    $site = @"
learn.ethanyanxu.com {
    encode zstd gzip
    header X-YanLearn-Host finprint-host
    handle_path /_next/static/* {
        root * $staticPath
        header Cache-Control "public, max-age=31536000, immutable"
        file_server
    }
    handle {
        reverse_proxy 127.0.0.1:$Port
    }
    log {
        output file $logPath {
            roll_size 10MB
            roll_keep 5
        }
    }
}
"@
    $log = Join-Path $Root 'logs\caddy-reload.log'
    $utf8 = New-Object Text.UTF8Encoding $false
    try {
        [IO.File]::WriteAllText($sitePath, $site, $utf8)
        $marker = '# BEGIN YanLearn (managed)'
        if (-not $oldMain.Contains($marker)) {
            $importPath = $sitePath -replace '\\','/'
            [IO.File]::WriteAllText($Config.mainCaddyfile, $oldMain.TrimEnd() + "`r`n`r`n$marker`r`nimport $importPath`r`n# END YanLearn (managed)`r`n", $utf8)
        }
        Invoke-Tool $Config.caddy @('validate','--config',$Config.mainCaddyfile,'--adapter','caddyfile') $log
        Invoke-Tool $Config.caddy @('reload','--config',$Config.mainCaddyfile,'--adapter','caddyfile') $log
    } catch {
        [IO.File]::WriteAllText($Config.mainCaddyfile, $oldMain, $utf8)
        if ($null -ne $oldSite) { [IO.File]::WriteAllText($sitePath, $oldSite, $utf8) }
        # A rejected reload keeps the old live config, but restoring it also
        # covers a network error after Caddy accepted the new configuration.
        try { Invoke-Tool $Config.caddy @('reload','--config',$Config.mainCaddyfile,'--adapter','caddyfile') $log } catch {}
        throw
    }
}
