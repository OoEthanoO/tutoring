# Regression check for merging assets into Next.js standalone's partial trees.
# Runs on Windows PowerShell 5.1 without administrator access or credentials.
. (Join-Path $PSScriptRoot 'common.ps1')
$scratch = Assert-UnderRoot (Join-Path ([IO.Path]::GetTempPath()) ('yanlearn-assets-' + [guid]::NewGuid().ToString('N'))) ([IO.Path]::GetTempPath())
try {
    $source = Join-Path $scratch 'repo\public'
    $destination = Join-Path $scratch 'release\public'
    foreach ($directory in @($source, (Join-Path $source 'nested [files]'), $destination, (Join-Path $destination 'nested [files]'))) {
        [IO.Directory]::CreateDirectory($directory) | Out-Null
    }
    [IO.File]::WriteAllText((Join-Path $source 'Letter of Support.pdf'), '%PDF-fixture')
    [IO.File]::WriteAllText((Join-Path $source 'nested [files]\new.txt'), 'new')
    [IO.File]::WriteAllText((Join-Path $source '.hidden'), 'hidden')
    [IO.File]::WriteAllText((Join-Path $destination 'traced.png'), 'already traced')
    [IO.File]::WriteAllText((Join-Path $destination 'nested [files]\old.txt'), 'retained chunk')
    Copy-DirectoryContents $source $destination
    [IO.File]::WriteAllText((Join-Path $source 'Letter of Support.pdf'), '%PDF-updated')
    Copy-DirectoryContents $source $destination
    $expected = @{
        'Letter of Support.pdf' = '%PDF-updated'
        'nested [files]\new.txt' = 'new'
        'nested [files]\old.txt' = 'retained chunk'
        '.hidden' = 'hidden'
        'traced.png' = 'already traced'
    }
    foreach ($entry in $expected.GetEnumerator()) {
        if ([IO.File]::ReadAllText((Join-Path $destination $entry.Key)) -ne $entry.Value) { throw "Asset contents mismatch: $($entry.Key)" }
    }
    if (Test-Path -LiteralPath (Join-Path $destination 'public')) { throw 'Assets were nested under a second public directory.' }
    if (@(Get-ChildItem -LiteralPath $destination -Recurse -File -Force).Count -ne $expected.Count) { throw 'Unexpected nested or duplicate assets.' }
    $fresh = Join-Path $scratch 'fresh'
    Copy-DirectoryContents $source $fresh
    if ([IO.File]::ReadAllText((Join-Path $fresh 'Letter of Support.pdf')) -ne '%PDF-updated') { throw 'Copy to a fresh directory failed.' }
    $missingRejected = $false
    try { Copy-DirectoryContents (Join-Path $scratch 'missing') (Join-Path $scratch 'unused') }
    catch { $missingRejected = $true }
    if (-not $missingRejected) { throw 'Missing assets did not fail the deployment.' }
    Write-Output 'PASS: fresh and prepopulated asset trees, repeat copying, literal paths, hidden files, retained chunks, and missing-source failure.'
} finally {
    $scratch = Assert-UnderRoot $scratch ([IO.Path]::GetTempPath())
    if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
}
