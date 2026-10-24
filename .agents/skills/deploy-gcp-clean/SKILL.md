---
name: deploy-gcp-clean
description: Use when deploying a GCP Cloud Run backend service on Windows to avoid ContainerImageImportFailed errors caused by Chinese character folder exclusion failures in gcloud CLI.
---

# Deploy GCP Clean

## Overview
Provides a reliable deployment workflow for GCP Cloud Run services when deploying from a Windows host. It bypasses a known bug where the Windows `gcloud` CLI fails to parse Chinese character patterns in `.gcloudignore`, which packages invalid character file paths and triggers Cloud Run's filesystem safety block.

## When to Use
* **Symptom**: Cloud Run deployment fails during the `Creating Revision` step with:
  ```text
  ERROR: (gcloud.run.deploy) Container import failed. (ContainerImageImportFailed)
  ```
* **Context**: You are running `gcloud run deploy --source .` on a **Windows** machine.
* **Condition**: The project directory contains folders or files with Chinese characters (e.g., `測試版/`, `正式版/`, `0627中油.doc`) that are listed in `.gcloudignore` but still get packaged because of Windows CLI encoding mismatches.

## Core Pattern
Create a temporary, 100% ASCII/English-only directory containing ONLY the necessary backend files, execute the deployment from there, and then clean up.

### Reusable PowerShell Script
Deploy using the following helper script located at `C:\Users\hilla\Desktop\奶昔code\.agents\skills\deploy-gcp-clean\deploy_gcp_clean.ps1`:

```powershell
# 🚀 Windows GCP Clean Deploy Script
# Run from project root

$sourceDir = Get-Item .
$cleanDir = "C:\Users\hilla\Desktop\newlngship_clean"

Write-Host "[*] Creating clean workspace at $cleanDir..." -ForegroundColor Cyan
if (Test-Path $cleanDir) { Remove-Item $cleanDir -Recurse -Force }
New-Item -ItemType Directory -Path $cleanDir | Out-Null

# Copy only necessary backend files
Write-Host "[*] Copying backend files..." -ForegroundColor Cyan
Copy-Item -Path "main.py" -Destination $cleanDir
Copy-Item -Path "app_test.py" -Destination $cleanDir
Copy-Item -Path "requirements.txt" -Destination $cleanDir
Copy-Item -Path "Dockerfile" -Destination $cleanDir
Copy-Item -Path "config.json" -Destination $cleanDir -ErrorAction SilentlyContinue
Copy-Item -Path "service_account.json" -Destination $cleanDir -ErrorAction SilentlyContinue
Copy-Item -Path "src" -Destination $cleanDir -Recurse

# Execute gcloud deploy from the clean directory
Write-Host "[*] Triggering gcloud run deploy..." -ForegroundColor Yellow
Push-Location $cleanDir
gcloud run deploy forecast-api-test --source . --region asia-southeast1 --allow-unauthenticated --execution-environment gen2
Pop-Location

Write-Host "[*] Deployment finished." -ForegroundColor Green
```

## Common Mistakes
* **Executing `gcloud` from the project root**: Doing so bypasses the `.gcloudignore` rules on Windows due to Big5/UTF-8 page encoding differences. Always deploy from the clean temporary directory.
* **Deleting the clean directory while deployment runs**: Cloud Build builds asynchronously, but the source is uploaded synchronously. Wait until the terminal says "Uploading sources... done" before touching the source files.
