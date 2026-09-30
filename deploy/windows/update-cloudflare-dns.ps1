# Shared home-server address updates after the ethanyanxu.com DNS migration.
[CmdletBinding()]
param([string]$SettingsPath = 'C:\ProgramData\YanLearn\secrets\cloudflare-ddns.json')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$statusPath = Join-Path (Split-Path -Parent $SettingsPath) 'cloudflare-ddns-status.json'
$utf8 = New-Object Text.UTF8Encoding $false

function Test-PublicIPv4([string]$Value) {
    $parsed = $null
    if ($Value -notmatch '^\d{1,3}(\.\d{1,3}){3}$' -or
        -not [Net.IPAddress]::TryParse($Value, [ref]$parsed) -or
        $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
    $b = $parsed.GetAddressBytes()
    return -not ($b[0] -in 0,10,127 -or $b[0] -ge 224 -or
        ($b[0] -eq 100 -and $b[1] -ge 64 -and $b[1] -le 127) -or
        ($b[0] -eq 169 -and $b[1] -eq 254) -or
        ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) -or
        ($b[0] -eq 192 -and $b[1] -eq 168))
}

function Invoke-DnsApi([string]$Method, [string]$Path, $Body = $null) {
    $request = @{Uri=('https://api.cloudflare.com/client/v4' + $Path); Method=$Method; Headers=$script:dnsHeaders; TimeoutSec=25}
    if ($null -ne $Body) { $request.Body=$Body | ConvertTo-Json -Compress; $request.ContentType='application/json' }
    try { $response = Invoke-RestMethod @request }
    catch { throw 'Cloudflare DNS request failed. Check token expiry, access and connectivity.' }
    if (-not $response.success) { throw 'Cloudflare did not accept the DNS request.' }
    return $response.result
}

function Read-ManagedRecord($Settings, $Expected) {
    $record = Invoke-DnsApi 'GET' ('/zones/{0}/dns_records/{1}' -f $Settings.ZoneId,$Expected.id)
    if ($record.id -ne $Expected.id -or $record.name -ne $Expected.name -or $record.type -ne 'A' -or $record.proxied) {
        throw 'A managed DNS record changed identity, type or proxy status. No replacement will be created.'
    }
    return $record
}

try {
    $settings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json
    if ($settings.ZoneId -notmatch '^[a-f0-9]{32}$') { throw 'Invalid zone identifier.' }
    $names = @($settings.Records | ForEach-Object { $_.name } | Sort-Object -Unique)
    if (@($settings.Records).Count -ne 2 -or ($names -join ',') -ne 'ai.ethanyanxu.com,finprint.ethanyanxu.com') {
        throw 'This updater manages only the two home-server A records.'
    }
    foreach ($record in $settings.Records) {
        if ($record.id -notmatch '^[a-f0-9]{32}$') { throw 'Invalid managed DNS record identifier.' }
    }
    Add-Type -AssemblyName System.Security
    $plain = [Security.Cryptography.ProtectedData]::Unprotect(
        [Convert]::FromBase64String([IO.File]::ReadAllText($settings.TokenPath)), $null,
        [Security.Cryptography.DataProtectionScope]::LocalMachine)
    $script:dnsHeaders = @{Authorization=('Bearer ' + [Text.Encoding]::UTF8.GetString($plain))}
    [Array]::Clear($plain,0,$plain.Length)

    $addresses = @()
    foreach ($service in 'https://api.ipify.org','https://checkip.amazonaws.com','https://ipv4.icanhazip.com') {
        try {
            $candidate = (Invoke-RestMethod -Uri $service -TimeoutSec 10).ToString().Trim()
            if (Test-PublicIPv4 $candidate) { $addresses += $candidate }
        } catch {}
        if ($addresses.Count -ge 2) { break }
    }
    if ($addresses.Count -lt 2 -or $addresses[0] -ne $addresses[1]) {
        throw 'Two independent services did not confirm the same public IPv4. DNS was not changed.'
    }
    # Validate both identities before modifying either record.
    $current = @($settings.Records | ForEach-Object { Read-ManagedRecord $settings $_ })
    $changed = @()
    for ($i=0; $i -lt $current.Count; $i++) {
        if ($current[$i].content -ne $addresses[0]) {
            $null = Invoke-DnsApi 'PATCH' ('/zones/{0}/dns_records/{1}' -f $settings.ZoneId,$current[$i].id) @{content=$addresses[0]}
            $verified = Read-ManagedRecord $settings $settings.Records[$i]
            if ($verified.content -ne $addresses[0]) { throw 'DNS update verification failed.' }
            $changed += $verified.name
        }
    }
    $status = @{CheckedAt=[DateTime]::UtcNow.ToString('o'); Success=$true; PublicIPv4=$addresses[0]; Changed=$changed; TokenExpires=$settings.TokenExpires}
    [IO.File]::WriteAllText($statusPath,($status | ConvertTo-Json),$utf8)
    Write-Output ('Cloudflare DNS check passed for both home-server addresses; changes=' + $changed.Count)
} catch {
    $status = @{CheckedAt=[DateTime]::UtcNow.ToString('o'); Success=$false; Error=$_.Exception.Message}
    [IO.File]::WriteAllText($statusPath,($status | ConvertTo-Json),$utf8)
    throw
} finally { $script:dnsHeaders=$null }
