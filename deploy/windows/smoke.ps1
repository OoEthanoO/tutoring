# Integration check for the native Windows service runner. Uses a temporary
# loopback-only fixture, no production credentials, DNS, or shared Caddy edits.
[CmdletBinding()]
param([string]$Root = 'C:\ProgramData\YanLearn', [int]$Port = 3199)
. (Join-Path $PSScriptRoot 'common.ps1')
Assert-Administrator
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "Smoke-test port $Port is already occupied."
}
$id = [guid]::NewGuid().ToString('N')
$scratch = Assert-UnderRoot (Join-Path $Root ('smoke-' + $id)) $Root
$release = Join-Path $scratch 'releases\fixture'
$state = [pscustomobject]@{commit=('a' * 40); release=$release; port=$Port; taskName=('yanlearn-web-smoke-' + $id)}
try {
    foreach ($dir in @('logs','secrets','releases\fixture\app','releases\fixture\ops')) {
        New-Item -ItemType Directory -Path (Join-Path $scratch $dir) -Force | Out-Null
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'common.ps1'),(Join-Path $PSScriptRoot 'run.ps1') -Destination (Join-Path $release 'ops')
    Write-Json (Join-Path $scratch 'server.json') @{node=(Get-Command node.exe).Source}
    $fake = @{}
    foreach ($name in @('NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY',
        'NEXT_PUBLIC_SITE_URL','CRON_SECRET','RESEND_API_KEY','RESEND_FROM','DISCORD_BOT_TOKEN',
        'DISCORD_GUILD_ID','DISCORD_CLIENT_ID','DISCORD_CLIENT_SECRET','DISCORD_OAUTH_REDIRECT_URI',
        'RECORDINGS_S3_ENDPOINT','RECORDINGS_S3_ACCESS_KEY_ID','RECORDINGS_S3_SECRET_ACCESS_KEY')) {
        $fake[$name]='smoke-test-fixture'
    }
    foreach ($name in @('NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SITE_URL','DISCORD_OAUTH_REDIRECT_URI','RECORDINGS_S3_ENDPOINT')) {
        $fake[$name]='https://example.invalid'
    }
    $fake.DISCORD_CLIENT_ID='123456789012345678'
    $fake.DISCORD_GUILD_ID='123456789012345679'
    Write-Json (Join-Path $scratch 'secrets\production.json') $fake
    $server = @'
const http = require('node:http');
http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({status:'ok',commit:process.env.YANLEARN_COMMIT_SHA,hosting:process.env.YANLEARN_HOST}));
}).listen(Number(process.env.PORT), process.env.HOSTNAME);
'@
    [IO.File]::WriteAllText((Join-Path $release 'app\server.js'), $server)
    Register-WebTask $scratch $state
    if (-not (Test-Release $state 20)) { throw 'SYSTEM task did not start a healthy loopback server.' }
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port
    if ($listener.LocalAddress -ne '127.0.0.1') { throw 'Service is not loopback-only.' }
    Stop-WebTask $scratch $state
    if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw 'Stopping the task left its Node process running.' }
    Register-WebTask $scratch $state
    if (-not (Test-Release $state 20)) { throw 'Disabled release task could not be restarted for rollback.' }
    Write-Json (Join-Path $scratch 'state.json') @{pass=1}
    Write-Json (Join-Path $scratch 'state.json') @{pass=2}
    if ((Read-Json (Join-Path $scratch 'state.json')).pass -ne 2) { throw 'Atomic state update failed.' }
    Write-Output 'PASS: SYSTEM startup, loopback binding, process cleanup, rollback restart, and atomic state updates.'
} finally {
    Stop-WebTask $scratch $state
    Unregister-ScheduledTask -TaskName $state.taskName -Confirm:$false -ErrorAction SilentlyContinue
    $scratch = Assert-UnderRoot $scratch $Root
    if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
}
