param([switch]$Deploy)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& python "$PSScriptRoot\build_hosting.py"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($Deploy) {
    Push-Location $projectRoot
    try { firebase deploy --only hosting } finally { Pop-Location }
} else {
    Write-Host 'Hosting output was built only. Run with -Deploy after reviewing the changes.' -ForegroundColor Yellow
}
