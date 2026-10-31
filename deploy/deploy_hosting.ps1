param([switch]$Deploy)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& python "$PSScriptRoot\build_hosting.py"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $Deploy) {
    Write-Host 'Hosting output was built only. Run with -Deploy after reviewing the changes.' -ForegroundColor Yellow
    exit 0
}

$stage = Join-Path $projectRoot "runtime\hosting-deploy-$([guid]::NewGuid().ToString('N'))"
$exitCode = 1
try {
    $site = Join-Path $stage 'site'
    New-Item -ItemType Directory -Path $site -Force | Out-Null
    $public = Join-Path $projectRoot 'public'
    $items = @(Get-ChildItem -LiteralPath $public -Recurse -Force)
    if ($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Hosting output must not contain reparse points.' }
    $files = @($items | Where-Object { -not $_.PSIsContainer })
    if ($files.Count -eq 0) { throw 'Hosting output is empty.' }
    $manifest = @($files | ForEach-Object {
        $relative = $_.FullName.Substring($public.Length + 1)
        $target = Join-Path $site $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
        Copy-Item -LiteralPath $_.FullName -Destination $target
        @{ path = $relative.Replace('\', '/'); sha256 = $hash }
    })
    $utf8 = New-Object System.Text.UTF8Encoding $false
    $manifestPath = Join-Path $stage 'manifest.json'
    [IO.File]::WriteAllText($manifestPath, (ConvertTo-Json -InputObject @{ files = $manifest } -Depth 10), $utf8)
    $config = Get-Content -Raw -Encoding UTF8 (Join-Path $projectRoot 'firebase.json') | ConvertFrom-Json
    $config.hosting.public = $site
    $configPath = Join-Path $stage 'firebase.json'
    [IO.File]::WriteAllText($configPath, (ConvertTo-Json -InputObject $config -Depth 100), $utf8)
    & node (Join-Path $PSScriptRoot 'verify_hosting_stage.js') $site $manifestPath
    if ($LASTEXITCODE -ne 0) { throw 'Hosting stage verification failed; deployment stopped.' }
    & firebase deploy --only hosting --project newlngship --config $configPath
    $exitCode = $LASTEXITCODE
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
exit $exitCode
