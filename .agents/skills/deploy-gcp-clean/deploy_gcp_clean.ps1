param (
    [Parameter(Mandatory=$false)]
    [ValidateSet("test", "prod")]
    [string]$Environment = "test"
)

# 🚀 Windows GCP Clean Deploy Script
# Run from project root

$sourceDir = Get-Item .
$cleanDir = "C:\Users\hilla\Desktop\newlngship_clean"

Write-Host "[*] Creating clean workspace at $cleanDir..." -ForegroundColor Cyan
if (Test-Path $cleanDir) { Remove-Item $cleanDir -Recurse -Force }
New-Item -ItemType Directory -Path $cleanDir | Out-Null

# Copy only necessary backend files based on environment
Write-Host "[*] Copying backend files..." -ForegroundColor Cyan

if ($Environment -eq "test") {
    $srcPrefix = "測試版\"
    # test env uses app.py
    Copy-Item -Path "${srcPrefix}app.py" -Destination $cleanDir
} else {
    $srcPrefix = ""
    # prod env uses app_test.py (will be renamed/refactored later, but for now we keep it)
    Copy-Item -Path "app_test.py" -Destination $cleanDir
}

Copy-Item -Path "${srcPrefix}main.py" -Destination $cleanDir
Copy-Item -Path "${srcPrefix}requirements.txt" -Destination $cleanDir
Copy-Item -Path "${srcPrefix}Dockerfile" -Destination $cleanDir
Copy-Item -Path "${srcPrefix}src" -Destination $cleanDir -Recurse

# Generate .gcloudignore to ensure no secrets or local artifacts are ever uploaded
Write-Host "[*] Generating .gcloudignore..." -ForegroundColor Cyan
@"
config.json
service_account.json
.env
temp/
__pycache__/
"@ | Out-File -FilePath "$cleanDir\.gcloudignore" -Encoding ASCII


# Execute gcloud deploy from the clean directory
Write-Host "[*] Triggering gcloud run deploy..." -ForegroundColor Yellow
Push-Location $cleanDir
if ($Environment -eq "prod") {
    Write-Host "[*] Triggering gcloud run deploy for PRODUCTION (forecast-api-prod)..." -ForegroundColor Yellow
    gcloud run deploy forecast-api-prod --source . --region asia-southeast1 --allow-unauthenticated --execution-environment gen2 --update-env-vars="FIREBASE_RTDB_PREFIX="
} else {
    Write-Host "[*] Triggering gcloud run deploy for TEST (forecast-api-test)..." -ForegroundColor Yellow
    gcloud run deploy forecast-api-test --source . --region asia-southeast1 --allow-unauthenticated --execution-environment gen2 --update-env-vars="FIREBASE_RTDB_PREFIX=/test"
}
Pop-Location

# Run Artifact Registry auto-cleanup to keep storage under 500MB
Write-Host "[*] Triggering Artifact Registry auto-cleanup..." -ForegroundColor Yellow
python 測試版/cleanup_registry.py

Write-Host "[*] Deployment finished." -ForegroundColor Green
